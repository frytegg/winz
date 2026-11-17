// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IWinzEscrow} from "../../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../../src/WinzEscrow.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {TestnetOnly} from "../../script/TestnetOnly.sol";

/// @notice 18-decimal token: the escrow must refuse it at deployment.
contract EighteenDecimalToken {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

/// @notice The Deploy script with relayer and oracle swapped at construction: a stand-in for any
///         deployment whose on-chain state differs from the inputs.
contract SwappedRolesDeploy is Deploy {
    function _newEscrow(address token, Config memory config) internal override returns (WinzEscrow) {
        return new WinzEscrow(token, config.oracle, config.relayer, config.treasury, config.owner);
    }
}

/// @notice Runs script/Deploy.s.sol in-process.
/// @dev Forge runs test functions in parallel and environment variables are global to the process,
///      so every case that goes through the environment lives in one test function
///      (`test_run_readsTheEnvironment`), and every test that writes a deployment record uses its own
///      chain id. Records are read, then deleted, then asserted, so a failing assertion leaves no file.
///      The chain ids carry a random salt drawn in setUp, so two forge processes running in the same
///      checkout never write, read or delete the same deployments/<chainId>.json.
contract DeployScriptTest is Test {
    address internal relayer = makeAddr("relayer");
    address internal oracle = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");
    address internal owner = makeAddr("owner");

    Deploy internal deployer;
    uint256 internal chainSalt;

    function setUp() public {
        deployer = new Deploy();
        chainSalt = vm.randomUint(1, 1 << 30) * 1_000_000;
    }

    // ----------------------------------------------------------------------------------------------
    // deploy(config)
    // ----------------------------------------------------------------------------------------------

    function test_deploy_withGivenToken_deploysChecksAndRecords() public {
        vm.chainId(_cid(910_001));
        vm.roll(1234);
        TestUSDC token = new TestUSDC();

        Deploy.Deployment memory d = deployer.deploy(_config(address(token), false));

        WinzEscrow escrow = WinzEscrow(d.escrow);
        assertGt(d.escrow.code.length, 0, "escrow has code");
        assertEq(escrow.usdc(), address(token));
        assertEq(escrow.relayer(), relayer);
        assertEq(escrow.oracle(), oracle);
        assertEq(escrow.treasury(), treasury);
        assertEq(escrow.owner(), owner);
        assertEq(d.chainId, _cid(910_001));
        assertFalse(d.testUsdc);
        assertEq(d.deployedAtBlock, 1234);

        string memory json = _takeRecord(_cid(910_001));
        assertEq(vm.parseJsonUint(json, ".chainId"), _cid(910_001));
        assertEq(vm.parseJsonAddress(json, ".escrow"), d.escrow);
        assertEq(vm.parseJsonAddress(json, ".usdc"), address(token));
        assertEq(vm.parseJsonAddress(json, ".relayer"), relayer);
        assertEq(vm.parseJsonAddress(json, ".oracle"), oracle);
        assertEq(vm.parseJsonAddress(json, ".treasury"), treasury);
        assertEq(vm.parseJsonAddress(json, ".owner"), owner);
        assertFalse(vm.parseJsonBool(json, ".testUsdc"));
        assertEq(vm.parseJsonUint(json, ".deployedAtBlock"), 1234);
        assertEq(vm.parseJsonKeys(json, "$").length, 9, "exactly the documented fields");
    }

    function test_deploy_withTestUsdc_deploysTheTokenFirst() public {
        vm.chainId(_cid(910_002));

        Deploy.Deployment memory d = deployer.deploy(_config(address(0), true));

        TestUSDC token = TestUSDC(d.usdc);
        assertGt(d.usdc.code.length, 0, "TestUSDC deployed");
        assertEq(token.decimals(), 6);
        assertEq(token.symbol(), "tUSDC");
        // The broadcaster deployed it, so the broadcaster is the only one who can block addresses.
        assertEq(token.owner(), DEFAULT_SENDER);
        assertEq(WinzEscrow(d.escrow).usdc(), d.usdc);
        assertTrue(d.testUsdc);

        string memory json = _takeRecord(_cid(910_002));
        assertTrue(vm.parseJsonBool(json, ".testUsdc"));
        assertEq(vm.parseJsonAddress(json, ".usdc"), d.usdc);
    }

    function test_deploy_refusesATokenWithoutSixDecimals() public {
        vm.chainId(_cid(910_003));
        address token = address(new EighteenDecimalToken());
        vm.expectRevert(IWinzEscrow.InvalidTokenDecimals.selector);
        deployer.deploy(_config(token, false));
        assertFalse(vm.exists(_recordPath(_cid(910_003))), "no record for a failed deployment");
    }

    function test_deploy_refusesMainnets() public {
        TestUSDC token = new TestUSDC();
        uint256[2] memory mainnets = [uint256(1), 5042];
        for (uint256 i; i < mainnets.length; ++i) {
            vm.chainId(mainnets[i]);
            vm.expectRevert(abi.encodeWithSelector(TestnetOnly.MainnetRefused.selector, mainnets[i]));
            deployer.deploy(_config(address(token), false));
            vm.expectRevert(abi.encodeWithSelector(TestnetOnly.MainnetRefused.selector, mainnets[i]));
            deployer.run();
            assertFalse(vm.exists(_recordPath(mainnets[i])));
        }
    }

    function test_verify_revertsWhenAReadBackDiffers() public {
        vm.chainId(_cid(910_004));
        TestUSDC token = new TestUSDC();
        Deploy.Deployment memory d = deployer.deploy(_config(address(token), false));
        _takeRecord(_cid(910_004));

        address wrong = makeAddr("wrong");
        string[5] memory fields = ["usdc", "relayer", "oracle", "treasury", "owner"];
        address[5] memory actual = [d.usdc, d.relayer, d.oracle, d.treasury, d.owner];
        for (uint256 i; i < fields.length; ++i) {
            // A struct copied from calldata of an external call is a fresh copy: build it that way.
            Deploy.Deployment memory tampered = this.copyOf(d);
            if (i == 0) tampered.usdc = wrong;
            if (i == 1) tampered.relayer = wrong;
            if (i == 2) tampered.oracle = wrong;
            if (i == 3) tampered.treasury = wrong;
            if (i == 4) tampered.owner = wrong;
            vm.expectRevert(
                abi.encodeWithSelector(Deploy.ReadBackMismatch.selector, fields[i], wrong, actual[i])
            );
            deployer.verify(tampered);
        }
        deployer.verify(d);
    }

    /// @dev deploy() must run the read-back check on what it deployed: a deployment whose constructor
    ///      arguments come out swapped is refused, and no record is written for it.
    function test_deploy_refusesADeploymentThatDoesNotReadBack() public {
        uint256 chainId = _cid(910_005);
        vm.chainId(chainId);
        TestUSDC token = new TestUSDC();
        Deploy faulty = new SwappedRolesDeploy();
        vm.expectRevert(abi.encodeWithSelector(Deploy.ReadBackMismatch.selector, "relayer", relayer, oracle));
        faulty.deploy(_config(address(token), false));
        bool written = vm.exists(_recordPath(chainId));
        if (written) vm.removeFile(_recordPath(chainId));
        assertFalse(written, "no record for a deployment that does not read back");
    }

    // ----------------------------------------------------------------------------------------------
    // run(): the environment
    // ----------------------------------------------------------------------------------------------

    /// @dev Sequential on purpose: see the contract's note on parallel tests.
    function test_run_readsTheEnvironment() public {
        _setRoles(relayer, oracle, treasury, owner);

        // 1. DEPLOY_TEST_USDC=true: TestUSDC is deployed and used.
        vm.chainId(_cid(910_011));
        vm.setEnv("DEPLOY_USDC", "");
        vm.setEnv("DEPLOY_TEST_USDC", "true");
        Deploy.Deployment memory withTest = deployer.run();
        assertTrue(withTest.testUsdc);
        assertEq(TestUSDC(withTest.usdc).decimals(), 6);
        assertEq(WinzEscrow(withTest.escrow).relayer(), relayer);
        assertEq(WinzEscrow(withTest.escrow).owner(), owner);
        assertTrue(vm.parseJsonBool(_takeRecord(_cid(910_011)), ".testUsdc"));

        // 2. DEPLOY_USDC names a token: used as is, no TestUSDC.
        vm.chainId(_cid(910_012));
        address token = address(new TestUSDC());
        vm.setEnv("DEPLOY_USDC", vm.toString(token));
        vm.setEnv("DEPLOY_TEST_USDC", "false");
        Deploy.Deployment memory withToken = deployer.run();
        assertFalse(withToken.testUsdc);
        assertEq(WinzEscrow(withToken.escrow).usdc(), token);
        assertEq(vm.parseJsonAddress(_takeRecord(_cid(910_012)), ".usdc"), token);

        // 3. Nothing set: the Arc USDC ERC-20 interface. Its code is faked here with TestUSDC's,
        //    whose `decimals()` is pure and so answers 6 without storage.
        vm.chainId(_cid(910_013));
        vm.setEnv("DEPLOY_USDC", "");
        vm.setEnv("DEPLOY_TEST_USDC", "");
        Deploy.Config memory config = deployer.readConfig();
        assertEq(config.usdc, 0x3600000000000000000000000000000000000000);
        assertFalse(config.deployTestUsdc);
        vm.etch(deployer.ARC_USDC(), token.code);
        Deploy.Deployment memory onArcUsdc = deployer.run();
        assertEq(WinzEscrow(onArcUsdc.escrow).usdc(), deployer.ARC_USDC());
        _takeRecord(_cid(910_013));

        // 4. Refusals.
        vm.setEnv("DEPLOY_TEST_USDC", "yes");
        vm.expectRevert(abi.encodeWithSelector(Deploy.InvalidTestUsdcFlag.selector, "yes"));
        deployer.readConfig();

        vm.setEnv("DEPLOY_TEST_USDC", "true");
        vm.setEnv("DEPLOY_USDC", vm.toString(token));
        vm.expectRevert(abi.encodeWithSelector(Deploy.ConflictingToken.selector, token));
        deployer.readConfig();

        vm.setEnv("DEPLOY_TEST_USDC", "false");
        vm.setEnv("DEPLOY_ORACLE", "");
        vm.expectRevert(abi.encodeWithSelector(Deploy.MissingEnv.selector, "DEPLOY_ORACLE"));
        deployer.readConfig();

        vm.setEnv("DEPLOY_ORACLE", vm.toString(address(0)));
        vm.expectRevert(abi.encodeWithSelector(Deploy.ZeroAddressEnv.selector, "DEPLOY_ORACLE"));
        deployer.readConfig();

        vm.setEnv("DEPLOY_ORACLE", vm.toString(oracle));
        vm.setEnv("DEPLOY_OWNER", "");
        vm.expectRevert(abi.encodeWithSelector(Deploy.MissingEnv.selector, "DEPLOY_OWNER"));
        deployer.readConfig();

        // 5. A run against a mainnet reads nothing and deploys nothing.
        _setRoles(relayer, oracle, treasury, owner);
        vm.chainId(5042);
        vm.expectRevert(abi.encodeWithSelector(TestnetOnly.MainnetRefused.selector, 5042));
        deployer.run();

        _clearEnv();
    }

    // ----------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------

    /// @dev Returns its argument; called externally, it hands back an independent memory copy.
    function copyOf(Deploy.Deployment calldata d) external pure returns (Deploy.Deployment memory) {
        return d;
    }

    function _config(address token, bool deployTestUsdc) internal view returns (Deploy.Config memory) {
        return Deploy.Config({
            usdc: token,
            relayer: relayer,
            oracle: oracle,
            treasury: treasury,
            owner: owner,
            deployTestUsdc: deployTestUsdc
        });
    }

    /// @dev A chain id private to this test run: `local` plus the salt drawn in setUp.
    function _cid(uint256 local) internal view returns (uint256) {
        return chainSalt + local;
    }

    function _recordPath(uint256 chainId) internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(chainId), ".json");
    }

    /// @dev Reads the deployment record of `chainId` and deletes it.
    function _takeRecord(uint256 chainId) internal returns (string memory json) {
        string memory path = _recordPath(chainId);
        assertTrue(vm.exists(path), "deployment record written");
        json = vm.readFile(path);
        vm.removeFile(path);
    }

    function _setRoles(address relayer_, address oracle_, address treasury_, address owner_) internal {
        vm.setEnv("DEPLOY_RELAYER", vm.toString(relayer_));
        vm.setEnv("DEPLOY_ORACLE", vm.toString(oracle_));
        vm.setEnv("DEPLOY_TREASURY", vm.toString(treasury_));
        vm.setEnv("DEPLOY_OWNER", vm.toString(owner_));
    }

    function _clearEnv() internal {
        string[6] memory names = [
            "DEPLOY_USDC",
            "DEPLOY_TEST_USDC",
            "DEPLOY_RELAYER",
            "DEPLOY_ORACLE",
            "DEPLOY_TREASURY",
            "DEPLOY_OWNER"
        ];
        for (uint256 i; i < names.length; ++i) {
            vm.setEnv(names[i], "");
        }
    }
}
