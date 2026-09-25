#!/usr/bin/env python3
"""JSON-lines bridge around MiService's supported micoapi login flow."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sys
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

try:
    from miservice import MiAccount
except ModuleNotFoundError:
    MiAccount = None  # type: ignore[assignment,misc]


class XiaomiTokens(TypedDict):
    user_id: str
    device_id: str
    pass_token: str
    service_token: str
    ssecurity: str


class ProtocolError(Exception):
    """Raised for malformed local bridge messages or MiService token shapes."""

    def __init__(self, code: str = "invalid_request"):
        super().__init__(code)
        self.code = code


def send(event: str, **payload: Any) -> None:
    print(json.dumps({"event": event, **payload}, separators=(",", ":")), flush=True)


async def read_message() -> dict[str, Any]:
    line = await asyncio.to_thread(sys.stdin.readline)
    if not line:
        raise ProtocolError("input_closed")
    try:
        value = json.loads(line)
    except json.JSONDecodeError as error:
        raise ProtocolError("invalid_request") from error
    if not isinstance(value, dict):
        raise ProtocolError("invalid_request")
    return value


def require_string(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value:
        raise ProtocolError(code)
    return value


def require_user_id(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        raise ProtocolError("missing_user_id")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and value:
        return value
    raise ProtocolError("missing_user_id")


def normalize_tokens(token: Any) -> XiaomiTokens:
    if not isinstance(token, dict):
        raise ProtocolError("token_shape_invalid")
    service = token.get("micoapi")
    if not isinstance(service, (list, tuple)) or len(service) != 2:
        raise ProtocolError("token_shape_invalid")
    ssecurity = require_string(service[0], "missing_ssecurity")
    service_token = require_string(service[1], "missing_service_token")
    return {
        "user_id": require_user_id(token.get("userId")),
        "device_id": require_string(token.get("deviceId"), "missing_device_id"),
        "pass_token": require_string(token.get("passToken"), "missing_pass_token"),
        "service_token": service_token,
        "ssecurity": ssecurity,
    }


def to_miservice_token(tokens: dict[str, Any]) -> dict[str, Any]:
    return {
        "userId": require_user_id(tokens.get("user_id")),
        "deviceId": require_string(tokens.get("device_id"), "missing_device_id"),
        "passToken": require_string(tokens.get("pass_token"), "missing_pass_token"),
        "micoapi": (
            require_string(tokens.get("ssecurity"), "missing_ssecurity"),
            require_string(tokens.get("service_token"), "missing_service_token"),
        ),
    }


async def close_account(account: Any) -> None:
    close = getattr(account, "close", None)
    if close:
        await close()


async def login_account(
    username: str,
    password: str,
    otp_callback: Callable[[str], Awaitable[str]],
) -> XiaomiTokens:
    if MiAccount is None:
        raise RuntimeError("miservice is unavailable")
    account = MiAccount(None, username, password, token_store=None, otp_callback=otp_callback)
    try:
        if not await account.login("micoapi"):
            raise RuntimeError("xiaomi login rejected")
        return normalize_tokens(account.token)
    finally:
        await close_account(account)


async def refresh_account(tokens: dict[str, Any]) -> XiaomiTokens:
    if MiAccount is None:
        raise RuntimeError("miservice is unavailable")
    account = MiAccount(None, "", "", token_store=None, otp_callback=None)
    try:
        account.token = to_miservice_token(tokens)
        if not await account.login("micoapi"):
            raise RuntimeError("saved xiaomi session rejected")
        return normalize_tokens(account.token)
    finally:
        await close_account(account)


async def request_otp(method: str) -> str:
    normalized_method = "email" if method.strip().lower() == "email" else "sms"
    send("verification_required", method=normalized_method)
    message = await read_message()
    if message.get("action") != "submit_otp":
        raise ProtocolError("invalid_request")
    code = require_string(message.get("code"), "invalid_verification_code").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{4,12}", code):
        raise ProtocolError("invalid_verification_code")
    return code


async def handle(command: dict[str, Any]) -> None:
    action = command.get("action")
    if action == "login":
        username = require_string(command.get("username"), "missing_username").strip()
        password = require_string(command.get("password"), "missing_password")
        send("pending")
        tokens = await login_account(username, password, request_otp)
        send("authenticated", tokens=tokens)
        return
    if action == "refresh":
        stored = command.get("tokens")
        if not isinstance(stored, dict):
            raise ProtocolError("invalid_request")
        send("pending")
        tokens = await refresh_account(stored)
        send("authenticated", tokens=tokens)
        return
    raise ProtocolError("invalid_request")


async def main() -> None:
    logging.disable(logging.CRITICAL)
    try:
        await handle(await read_message())
    except ProtocolError as error:
        send("failed", code=error.code)
    except RuntimeError as error:
        if str(error) == "miservice is unavailable":
            send("failed", code="helper_unavailable")
        elif str(error) == "saved xiaomi session rejected":
            send("failed", code="saved_session_rejected")
        else:
            send("failed", code="xiaomi_login_rejected")
    except Exception:
        send("failed", code="xiaomi_login_failed")


if __name__ == "__main__":
    asyncio.run(main())
