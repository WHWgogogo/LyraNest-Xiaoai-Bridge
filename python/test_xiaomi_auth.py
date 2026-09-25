import asyncio
import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("xiaomi_auth.py")
SPEC = importlib.util.spec_from_file_location("xiaomi_auth", MODULE_PATH)
assert SPEC and SPEC.loader
xiaomi_auth = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(xiaomi_auth)


class FakeAccount:
    require_otp = False
    received_otp = ""
    closed = False

    def __init__(self, _session, _username, _password, token_store, otp_callback):
        self.token_store = token_store
        self.otp_callback = otp_callback
        self.token = None

    async def login(self, sid):
        if FakeAccount.require_otp:
            FakeAccount.received_otp = await self.otp_callback("Phone")
        if self.token is None:
            self.token = {
                "userId": "user",
                "deviceId": "device",
                "passToken": "pass",
                sid: ("security", "service"),
            }
        else:
            self.token[sid] = ("refreshed-security", "refreshed-service")
        return True

    async def close(self):
        FakeAccount.closed = True


class XiaomiAuthTests(unittest.TestCase):
    def setUp(self):
        self.original_account = xiaomi_auth.MiAccount
        xiaomi_auth.MiAccount = FakeAccount
        FakeAccount.require_otp = False
        FakeAccount.received_otp = ""
        FakeAccount.closed = False

    def tearDown(self):
        xiaomi_auth.MiAccount = self.original_account

    def test_normalizes_miservice_token_without_extra_fields(self):
        result = xiaomi_auth.normalize_tokens({
            "userId": "user",
            "deviceId": "device",
            "passToken": "pass",
            "micoapi": ("security", "service"),
            "unused": "ignored",
        })
        self.assertEqual(result, {
            "user_id": "user",
            "device_id": "device",
            "pass_token": "pass",
            "service_token": "service",
            "ssecurity": "security",
        })

    def test_normalizes_numeric_miservice_user_id(self):
        result = xiaomi_auth.normalize_tokens({
            "userId": 123456789,
            "deviceId": "device",
            "passToken": "pass",
            "micoapi": ("security", "service"),
        })

        self.assertEqual(result["user_id"], "123456789")

    def test_rejects_missing_miservice_fields_with_a_safe_specific_code(self):
        with self.assertRaisesRegex(xiaomi_auth.ProtocolError, "^missing_service_token$"):
            xiaomi_auth.normalize_tokens({
                "userId": "user",
                "deviceId": "device",
                "passToken": "pass",
                "micoapi": ("security", ""),
            })

        with self.assertRaisesRegex(xiaomi_auth.ProtocolError, "^token_shape_invalid$"):
            xiaomi_auth.normalize_tokens({
                "userId": "user",
                "deviceId": "device",
                "passToken": "pass",
                "micoapi": "invalid",
            })

    def test_account_login_returns_normalized_tokens_and_closes_session(self):
        async def no_otp(_method):
            self.fail("OTP callback should not be used")

        result = asyncio.run(xiaomi_auth.login_account("account", "password", no_otp))

        self.assertEqual(result["service_token"], "service")
        self.assertTrue(FakeAccount.closed)

    def test_account_login_waits_for_the_otp_callback(self):
        FakeAccount.require_otp = True

        async def provide_otp(method):
            self.assertEqual(method, "Phone")
            return "123456"

        result = asyncio.run(xiaomi_auth.login_account("account", "password", provide_otp))

        self.assertEqual(result["user_id"], "user")
        self.assertEqual(FakeAccount.received_otp, "123456")

    def test_refresh_restores_miservice_session_shape(self):
        result = asyncio.run(xiaomi_auth.refresh_account({
            "user_id": "user",
            "device_id": "device",
            "pass_token": "pass",
            "service_token": "service",
            "ssecurity": "security",
        }))

        self.assertEqual(result["ssecurity"], "refreshed-security")
        self.assertEqual(result["service_token"], "refreshed-service")


if __name__ == "__main__":
    unittest.main()
