// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {WinzEscrow} from "../src/WinzEscrow.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {TestnetOnly} from "./TestnetOnly.sol";

/// @title Deploy
/// @notice Deploys WinzEscrow, checks what was deployed and records it in deployments/<chainId>.json.
/// @dev Inputs, all read from the environment by `readConfig`:
///      - DEPLOY_RELAYER, DEPLOY_ORACLE, DEPLOY_TREASURY, DEPLOY_OWNER: required, non-zero addresses.
///      - DEPLOY_USDC: token address; defaults to the ERC-20 interface of USDC on Arc.
///      - DEPLOY_TEST_USDC: "true" deploys TestUSDC first and uses it as the token (the fallback when
///        no testnet USDC allocation is available, SPEC hypothesis 8). "false" or unset: no TestUSDC.
///        Any other value is refused, and so is "true" together with DEPLOY_USDC.
///      The broadcasting account comes from the command line (--private-key, --account, --sender).
contract Deploy is TestnetOnly {
    /// @notice ERC-20 interface of USDC on Arc (6 decimals). Never the 18-decimal native balance.
    address public constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    struct Config {
        address usdc;
        address relayer;
        address oracle;
        address treasury;
        address owner;
        bool deployTestUsdc;
    }

    struct Deployment {
        uint256 chainId;
        address escrow;
        address usdc;
        address relayer;
        address oracle;
        address treasury;
        address owner;
        bool testUsdc;
        uint256 deployedAtBlock;
    }

    /// @notice A required environment variable is unset or empty.
    error MissingEnv(string name);
    /// @notice An address input is the zero address.
    error ZeroAddressEnv(string name);
    /// @notice DEPLOY_TEST_USDC is neither "true", "false" nor empty.
    error InvalidTestUsdcFlag(string value);
    /// @notice DEPLOY_TEST_USDC is "true" while DEPLOY_USDC names a token: the intent is ambiguous.
    error ConflictingToken(address usdc);
    /// @notice A value read back from the deployed escrow differs from the input.
    error ReadBackMismatch(string field, address expected, address actual);

    /// @notice Entry point of `forge script`: reads the environment, deploys, checks, records.
    function run() external returns (Deployment memory) {
        _refuseMainnet();
        return deploy(readConfig());
    }

    /// @notice Reads and validates the deployment inputs from the environment.
    function readConfig() public view returns (Config memory config) {
        string memory flag = vm.envOr("DEPLOY_TEST_USDC", string(""));
        bytes32 flagHash = keccak256(bytes(flag));
        if (flagHash == keccak256("true")) {
            config.deployTestUsdc = true;
        } else if (flagHash != keccak256("false") && flagHash != keccak256("")) {
            revert InvalidTestUsdcFlag(flag);
        }

        string memory usdc = vm.envOr("DEPLOY_USDC", string(""));
        if (bytes(usdc).length == 0) {
            // With TestUSDC the token is only known once deployed.
            config.usdc = config.deployTestUsdc ? address(0) : ARC_USDC;
        } else {
            config.usdc = _parseNonZero("DEPLOY_USDC", usdc);
            if (config.deployTestUsdc) revert ConflictingToken(config.usdc);
        }

        config.relayer = _requiredAddress("DEPLOY_RELAYER");
        config.oracle = _requiredAddress("DEPLOY_ORACLE");
        config.treasury = _requiredAddress("DEPLOY_TREASURY");
        config.owner = _requiredAddress("DEPLOY_OWNER");
    }

    /// @notice Deploys (TestUSDC if asked, then WinzEscrow), checks the deployed state and writes
    ///         deployments/<chainId>.json. On a dry run (`forge script` without --broadcast) the
    ///         record is printed but not written, so a rehearsal never overwrites a real record.
    function deploy(Config memory config) public returns (Deployment memory d) {
        _refuseMainnet();

        vm.startBroadcast();
        address token = config.usdc;
        if (config.deployTestUsdc) token = address(new TestUSDC());
        WinzEscrow escrow = _newEscrow(token, config);
        vm.stopBroadcast();

        d = Deployment({
            chainId: block.chainid,
            escrow: address(escrow),
            usdc: token,
            relayer: config.relayer,
            oracle: config.oracle,
            treasury: config.treasury,
            owner: config.owner,
            testUsdc: config.deployTestUsdc,
            deployedAtBlock: block.number
        });
        verify(d);

        string memory json = toJson(d);
        if (vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) {
            console2.log("Dry run: deployment record not written.");
            console2.log(json);
        } else {
            vm.writeJson(json, _deploymentPath());
            console2.log("Deployment record written to", _deploymentPath());
        }
        console2.log("WinzEscrow:", d.escrow);
        console2.log("Token:", d.usdc);
    }

    /// @notice Reads the deployed escrow back and reverts with ReadBackMismatch on any difference.
    function verify(Deployment memory d) public view {
        WinzEscrow escrow = WinzEscrow(d.escrow);
        _same("usdc", d.usdc, escrow.usdc());
        _same("relayer", d.relayer, escrow.relayer());
        _same("oracle", d.oracle, escrow.oracle());
        _same("treasury", d.treasury, escrow.treasury());
        _same("owner", d.owner, escrow.owner());
    }

    /// @notice The deployment record as JSON, as written to deployments/<chainId>.json.
    function toJson(Deployment memory d) public returns (string memory json) {
        string memory key = "deployment";
        vm.serializeUint(key, "chainId", d.chainId);
        vm.serializeAddress(key, "escrow", d.escrow);
        vm.serializeAddress(key, "usdc", d.usdc);
        vm.serializeAddress(key, "relayer", d.relayer);
        vm.serializeAddress(key, "oracle", d.oracle);
        vm.serializeAddress(key, "treasury", d.treasury);
        vm.serializeAddress(key, "owner", d.owner);
        vm.serializeBool(key, "testUsdc", d.testUsdc);
        json = vm.serializeUint(key, "deployedAtBlock", d.deployedAtBlock);
    }

    /// @notice Creates the escrow, inside the broadcast opened by `deploy`.
    /// @dev Virtual only so that a test can substitute a faulty deployment and prove that `deploy`
    ///      runs the read-back check on what it deployed. The script itself never overrides it.
    function _newEscrow(address token, Config memory config) internal virtual returns (WinzEscrow) {
        return new WinzEscrow(token, config.relayer, config.oracle, config.treasury, config.owner);
    }

    function _requiredAddress(string memory name) private view returns (address) {
        string memory value = vm.envOr(name, string(""));
        if (bytes(value).length == 0) revert MissingEnv(name);
        return _parseNonZero(name, value);
    }

    function _parseNonZero(string memory name, string memory value) private pure returns (address parsed) {
        parsed = vm.parseAddress(value);
        if (parsed == address(0)) revert ZeroAddressEnv(name);
    }

    function _same(string memory field, address expected, address actual) private pure {
        if (expected != actual) revert ReadBackMismatch(field, expected, actual);
    }
}
