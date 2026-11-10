"""SNMP connectivity testing and device identity discovery."""

import asyncio

from pysnmp.hlapi.v3arch.asyncio import (
    SnmpEngine,
    CommunityData,
    UsmUserData,
    UdpTransportTarget,
    ContextData,
    ObjectType,
    ObjectIdentity,
    get_cmd,
    bulk_walk_cmd,
    USM_AUTH_NONE,
    USM_AUTH_HMAC96_SHA,
    USM_AUTH_HMAC192_SHA256,
    USM_PRIV_NONE,
    USM_PRIV_CFB128_AES,
    USM_PRIV_CFB256_AES,
)

AUTH_PROTOCOLS = {
    "SHA-1": USM_AUTH_HMAC96_SHA,
    "SHA-256": USM_AUTH_HMAC192_SHA256,
}

PRIV_PROTOCOLS = {
    "AES-128": USM_PRIV_CFB128_AES,
    "AES-256": USM_PRIV_CFB256_AES,
}

# Standard system-group OIDs
SYS_DESCR = "1.3.6.1.2.1.1.1.0"
SYS_OBJECT_ID = "1.3.6.1.2.1.1.2.0"
SYS_NAME = "1.3.6.1.2.1.1.5.0"

# Standard IF-MIB interface table OIDs
IF_INDEX = "1.3.6.1.2.1.2.2.1.1"
IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
IF_TYPE = "1.3.6.1.2.1.2.2.1.3"
IF_MTU = "1.3.6.1.2.1.2.2.1.4"
IF_SPEED = "1.3.6.1.2.1.2.2.1.5"
IF_ADMIN_STATUS = "1.3.6.1.2.1.2.2.1.7"
IF_OPER_STATUS = "1.3.6.1.2.1.2.2.1.8"
IF_IN_ERRORS = "1.3.6.1.2.1.2.2.1.14"
IF_OUT_ERRORS = "1.3.6.1.2.1.2.2.1.20"

# IF-MIB high-capacity counters (64-bit)
IF_NAME = "1.3.6.1.2.1.31.1.1.1.1"
IF_HIGH_SPEED = "1.3.6.1.2.1.31.1.1.1.15"
IF_HC_IN_OCTETS = "1.3.6.1.2.1.31.1.1.1.6"
IF_HC_OUT_OCTETS = "1.3.6.1.2.1.31.1.1.1.10"

def _build_auth(version: str, credentials: dict):
    """Build the PySNMP authentication object without exposing secrets."""

    if version == "2c":
        community = credentials.get("community", "").strip()

        if not community:
            raise ValueError("SNMPv2c community string is missing.")

        return CommunityData(community, mpModel=1)

    if version != "3":
        raise ValueError(f"Unsupported SNMP version: {version}")

    username = credentials.get("user", "").strip()
    security_level = credentials.get("sec", "authPriv")

    if not username:
        raise ValueError("SNMPv3 username is missing.")

    if security_level == "noAuthNoPriv":
        return UsmUserData(
            username,
            authKey=None,
            privKey=None,
            authProtocol=USM_AUTH_NONE,
            privProtocol=USM_PRIV_NONE,
        )

    auth_key = credentials.get("key", "")

    if len(auth_key) < 8:
        raise ValueError(
            "SNMPv3 authentication passphrase must contain at least 8 characters."
        )

    auth_name = credentials.get("auth", "SHA-256")

    if auth_name not in AUTH_PROTOCOLS:
        raise ValueError(f"Unsupported SNMPv3 authentication protocol: {auth_name}")

    if security_level == "authNoPriv":
        return UsmUserData(
            username,
            authKey=auth_key,
            authProtocol=AUTH_PROTOCOLS[auth_name],
            privProtocol=USM_PRIV_NONE,
        )

    if security_level == "authPriv":
        priv_key = credentials.get("privkey", "")

        if len(priv_key) < 8:
            raise ValueError(
                "SNMPv3 privacy passphrase must contain at least 8 characters."
            )

        priv_name = credentials.get("priv", "AES-128")

        if priv_name not in PRIV_PROTOCOLS:
            raise ValueError(f"Unsupported SNMPv3 privacy protocol: {priv_name}")

        return UsmUserData(
            username,
            authKey=auth_key,
            privKey=priv_key,
            authProtocol=AUTH_PROTOCOLS[auth_name],
            privProtocol=PRIV_PROTOCOLS[priv_name],
        )

    raise ValueError(f"Unsupported SNMPv3 security level: {security_level}")


async def _get_identity(ip: str, auth, port: int, timeout: float, retries: int):
    """Perform one SNMP GET for the three standard system identity objects."""

    engine = SnmpEngine()

    try:
        target = await UdpTransportTarget.create(
            (ip, port),
            timeout=timeout,
            retries=retries,
        )

        error_indication, error_status, error_index, var_binds = await get_cmd(
            engine,
            auth,
            target,
            ContextData(),
            ObjectType(ObjectIdentity(SYS_DESCR)),
            ObjectType(ObjectIdentity(SYS_OBJECT_ID)),
            ObjectType(ObjectIdentity(SYS_NAME)),
        )

        if error_indication:
            raise RuntimeError(str(error_indication))

        if error_status:
            raise RuntimeError(
                f"{error_status.prettyPrint()} at varbind index {error_index}"
            )

        result = {}

        oid_map = {
            tuple(int(part) for part in SYS_DESCR.split(".")): "description",
            tuple(int(part) for part in SYS_OBJECT_ID.split(".")): "object_id",
            tuple(int(part) for part in SYS_NAME.split(".")): "sys_name",
        }

        for name, value in var_binds:
            field = oid_map.get(name.asTuple())

            if field:
                result[field] = value.prettyPrint()

        if not result:
            raise RuntimeError("The device returned no system identity information.")

        return result

    finally:
        engine.close_dispatcher()


async def _walk_interface_table(
    ip: str,
    auth,
    port: int = 161,
    timeout: float = 3,
    retries: int = 1,
):
    """Retrieve interface information using standard IF-MIB objects."""

    engine = SnmpEngine()

    columns = {
        "if_descr": IF_DESCR,
        "if_type": IF_TYPE,
        "if_mtu": IF_MTU,
        "if_speed": IF_SPEED,
        "admin_status": IF_ADMIN_STATUS,
        "oper_status": IF_OPER_STATUS,
        "in_errors": IF_IN_ERRORS,
        "out_errors": IF_OUT_ERRORS,
        "if_name": IF_NAME,
        "high_speed": IF_HIGH_SPEED,
        "in_octets": IF_HC_IN_OCTETS,
        "out_octets": IF_HC_OUT_OCTETS,
    }

    interfaces = {}

    try:
        target = await UdpTransportTarget.create(
            (ip, port),
            timeout=timeout,
            retries=retries,
        )

        for field, base_oid in columns.items():

            async for error_indication, error_status, error_index, var_binds in bulk_walk_cmd(
                engine,
                auth,
                target,
                ContextData(),
                0,
                25,
                ObjectType(ObjectIdentity(base_oid)),
                lexicographicMode=False,
            ):

                if error_indication:
                    raise RuntimeError(str(error_indication))

                if error_status:
                    raise RuntimeError(
                        f"{error_status.prettyPrint()} at index {error_index}"
                    )

                for name, value in var_binds:
                    oid = name.asTuple()
                    base = tuple(int(part) for part in base_oid.split("."))

                    if oid[:len(base)] != base:
                        continue

                    if len(oid) != len(base) + 1:
                        continue

                    index = oid[-1]

                    interfaces.setdefault(index, {
                        "index": index,
                    })

                    interfaces[index][field] = value.prettyPrint()

        results = []

        for index, data in sorted(interfaces.items()):

            def number(field):
                try:
                    return int(data[field])
                except (KeyError, ValueError, TypeError):
                    return None

            admin_status = number("admin_status")
            oper_status = number("oper_status")

            status_names = {
                1: "up",
                2: "down",
                3: "testing",
                4: "unknown",
                5: "dormant",
                6: "notPresent",
                7: "lowerLayerDown",
            }

            results.append({
                "index": index,
                "name": data.get("if_name") or data.get("if_descr"),
                "description": data.get("if_descr"),
                "type": number("if_type"),
                "mtu": number("if_mtu"),
                "speed_bps": (
                    (number("high_speed") * 1_000_000)
                    if number("high_speed") is not None
                    else number("if_speed")
                ),
                "admin_status": status_names.get(
                    admin_status, "unknown"
                ),
                "oper_status": status_names.get(
                    oper_status, "unknown"
                ),
                "in_octets": number("in_octets"),
                "out_octets": number("out_octets"),
                "in_errors": number("in_errors"),
                "out_errors": number("out_errors"),
            })

        return results

    finally:
        engine.close_dispatcher()


def discover_interfaces(
    ip: str,
    version: str,
    credentials: dict,
    port: int = 161,
    timeout: float = 3,
    retries: int = 1,
) -> dict:
    """Discover interfaces without modifying the device or database."""

    try:
        auth = _build_auth(version, credentials)

        interfaces = asyncio.run(
            _walk_interface_table(
                ip,
                auth,
                port,
                timeout,
                retries,
            )
        )

        return {
            "ok": True,
            "ip": ip,
            "interface_count": len(interfaces),
            "interfaces": interfaces,
        }

    except Exception as exc:
        return {
            "ok": False,
            "ip": ip,
            "interface_count": 0,
            "interfaces": [],
            "error": type(exc).__name__,
        }


def test_snmp(
    ip: str,
    version: str,
    credentials: dict,
    port: int = 161,
    timeout: float = 3,
    retries: int = 1,
) -> dict:
    """Test SNMP and return device identity. Never stores credentials."""

    try:
        auth = _build_auth(version, credentials)

        identity = asyncio.run(
            _get_identity(ip, auth, port, timeout, retries)
        )

        return {
            "ok": True,
            "identity": identity,
            "lines": [
                f"SNMPv{version} responded on UDP port {port}.",
                f"Device name: {identity.get('sys_name', 'Not reported')}",
                f"System description: {identity.get('description', 'Not reported')}",
                f"System object ID: {identity.get('object_id', 'Not reported')}",
            ],
        }

    except ValueError as exc:
        return {
            "ok": False,
            "identity": {},
            "lines": [f"SNMP configuration error: {exc}"],
        }

    except Exception as exc:
        # Do not include credentials or authentication objects in error output.
        message = str(exc).lower()

        if "timeout" in message:
            reason = "SNMP request timed out. Check UDP port 161, routing, ACLs and SNMP configuration."
        elif "authentication" in message or "digest" in message:
            reason = "SNMP authentication failed. Verify the username and authentication settings."
        elif "privacy" in message or "decrypt" in message:
            reason = "SNMP privacy verification failed. Check the privacy password and encryption protocol."
        else:
            reason = f"SNMP request failed: {type(exc).__name__}."

        return {
            "ok": False,
            "identity": {},
            "lines": [reason],
        }
