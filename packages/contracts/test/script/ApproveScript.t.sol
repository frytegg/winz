// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IWinzEscrow} from "../../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../../src/WinzEscrow.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {Approve} from "../../script/Approve.s.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {TestnetOnly} from "../../script/TestnetOnly.sol";

/// @notice Runs script/Approve.s.sol in-process.
/// @dev `vm.startBroadcast()` without arguments broadcasts from `tx.origin`, which is DEFAULT_SENDER
///      in a test: here DEFAULT_SENDER plays the treasury that runs the script. Only
///      `test_run_findsTheEscrow` touches the environment (see DeployScriptTest on parallel tests).
contract ApproveScriptTest is Test {
    uint128 internal constant ONE = 1e6;

    address internal relayer = makeAddr("relayer");
    address internal oracle = makeAddr("oracle");
    address internal owner = makeAddr("owner");
    address internal merchant = makeAddr("merchant");

    TestUSDC internal token;
    Approve internal approver;
    /// @dev Random salt for the chain ids whose deployment record is written (see DeployScriptTest).
    uint256 internal chainSalt;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new TestUSDC();
        approver = new Approve();
        chainSalt = vm.randomUint(1, 1 << 30) * 1_000_000;
    }

    function test_approve_setsTheMaximumAllowanceAndTheEscrowCanPull() public {
        WinzEscrow escrow = _escrow(DEFAULT_SENDER);
        assertEq(token.allowance(DEFAULT_SENDER, address(escrow)), 0);

        address approved = approver.approve(address(escrow));

        assertEq(approved, address(token));
        assertEq(token.allowance(DEFAULT_SENDER, address(escrow)), type(uint256).max);

        // The approval is what lets the escrow pull a hedge budget from the treasury.
        token.mint(DEFAULT_SENDER, 100 * ONE);
        IWinzEscrow.CampaignParams memory params = IWinzEscrow.CampaignParams({
            instrument: keccak256("GEMI-TEST"),
            salesClose: uint64(block.timestamp + 1 days),
            unitPrice: 20 * ONE,
            refundBps: 10_000
        });
        vm.prank(relayer);
        escrow.createCampaignFor(merchant, params, 100 * ONE);
        assertEq(token.balanceOf(address(escrow)), 100 * ONE);
    }

    function test_approve_refusesABroadcasterThatIsNotTheTreasury() public {
        address treasury = makeAddr("treasury");
        WinzEscrow escrow = _escrow(treasury);
        vm.expectRevert(abi.encodeWithSelector(Approve.NotTreasury.selector, DEFAULT_SENDER, treasury));
        approver.approve(address(escrow));
        assertEq(token.allowance(DEFAULT_SENDER, address(escrow)), 0);
    }

    function test_approve_refusesMainnets() public {
        WinzEscrow escrow = _escrow(DEFAULT_SENDER);
        uint256[2] memory mainnets = [uint256(1), 5042];
        for (uint256 i; i < mainnets.length; ++i) {
            vm.chainId(mainnets[i]);
            vm.expectRevert(abi.encodeWithSelector(TestnetOnly.MainnetRefused.selector, mainnets[i]));
            approver.approve(address(escrow));
            vm.expectRevert(abi.encodeWithSelector(TestnetOnly.MainnetRefused.selector, mainnets[i]));
            approver.run();
        }
        assertEq(token.allowance(DEFAULT_SENDER, address(escrow)), 0);
    }

    /// @dev Sequential on purpose: APPROVE_ESCROW is process-wide.
    function test_run_findsTheEscrow() public {
        // 1. From deployments/<chainId>.json, written by the Deploy script.
        uint256 chainId = _cid(920_001);
        vm.chainId(chainId);
        vm.setEnv("APPROVE_ESCROW", "");
        Deploy deployer = new Deploy();
        Deploy.Deployment memory d = deployer.deploy(
            Deploy.Config({
                usdc: address(token),
                relayer: relayer,
                oracle: oracle,
                treasury: DEFAULT_SENDER,
                owner: owner,
                deployTestUsdc: false
            })
        );
        string memory path = _recordPath(chainId);
        assertTrue(vm.exists(path), "deployment record written");
        (address escrowFromRecord, address tokenFromRecord) = approver.run();
        assertEq(escrowFromRecord, d.escrow);
        assertEq(tokenFromRecord, address(token));
        assertEq(token.allowance(DEFAULT_SENDER, d.escrow), type(uint256).max);

        // 2. APPROVE_ESCROW wins over the record, which is still in place and names another escrow.
        // The record's escrow gets a fresh deployment whose allowance is still zero, so an approval
        // that followed the record instead of the variable would show up on it.
        Deploy.Deployment memory recorded = deployer.deploy(
            Deploy.Config({
                usdc: address(token),
                relayer: relayer,
                oracle: oracle,
                treasury: DEFAULT_SENDER,
                owner: owner,
                deployTestUsdc: false
            })
        );
        assertEq(vm.parseJsonAddress(vm.readFile(path), ".escrow"), recorded.escrow);
        WinzEscrow other = _escrow(DEFAULT_SENDER);
        vm.setEnv("APPROVE_ESCROW", vm.toString(address(other)));
        address resolved = approver.escrowAddress();
        (address escrowFromEnv,) = approver.run();
        vm.setEnv("APPROVE_ESCROW", "");
        vm.removeFile(path);
        assertEq(resolved, address(other));
        assertEq(escrowFromEnv, address(other));
        assertEq(token.allowance(DEFAULT_SENDER, address(other)), type(uint256).max);
        assertEq(token.allowance(DEFAULT_SENDER, recorded.escrow), 0, "the record's escrow is not approved");

        // 3. Neither: refused with the path that was looked for.
        uint256 emptyChainId = _cid(920_002);
        vm.chainId(emptyChainId);
        vm.expectRevert(abi.encodeWithSelector(Approve.NoEscrow.selector, _recordPath(emptyChainId)));
        approver.run();
    }

    function _cid(uint256 local) internal view returns (uint256) {
        return chainSalt + local;
    }

    function _recordPath(uint256 chainId) internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(chainId), ".json");
    }

    function _escrow(address treasury) internal returns (WinzEscrow) {
        return new WinzEscrow(address(token), relayer, oracle, treasury, owner);
    }
}
