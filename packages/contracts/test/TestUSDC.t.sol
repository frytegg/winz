// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {TestUSDC} from "../src/mocks/TestUSDC.sol";

contract TestUSDCTest is Test {
    TestUSDC internal usdc;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public {
        usdc = new TestUSDC();
    }

    function test_metadata() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.symbol(), "tUSDC");
        assertEq(usdc.name(), "Test USDC");
        assertEq(usdc.owner(), address(this));
    }

    function test_mint_isOpenToAnyone() public {
        vm.prank(alice);
        usdc.mint(bob, 5e6);
        assertEq(usdc.balanceOf(bob), 5e6);
        assertEq(usdc.totalSupply(), 5e6);
    }

    function test_setBlocked_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        usdc.setBlocked(bob, true);
        assertFalse(usdc.blocked(bob));

        vm.expectEmit(address(usdc));
        emit TestUSDC.BlockedSet(bob, true);
        usdc.setBlocked(bob, true);
        assertTrue(usdc.blocked(bob));
    }

    function test_blocked_transfersToAndFromRevert_untilUnblocked() public {
        usdc.mint(alice, 10e6);
        usdc.mint(bob, 10e6);
        usdc.setBlocked(bob, true);

        // To the blocked address.
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.AccountBlocked.selector, bob));
        vm.prank(alice);
        usdc.transfer(bob, 1e6);

        // From the blocked address.
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.AccountBlocked.selector, bob));
        vm.prank(bob);
        usdc.transfer(alice, 1e6);

        // Through an allowance, both directions.
        vm.prank(bob);
        usdc.approve(carol, 5e6);
        vm.prank(alice);
        usdc.approve(carol, 5e6);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.AccountBlocked.selector, bob));
        vm.prank(carol);
        usdc.transferFrom(bob, alice, 1e6);
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.AccountBlocked.selector, bob));
        vm.prank(carol);
        usdc.transferFrom(alice, bob, 1e6);

        // Minting to it.
        vm.expectRevert(abi.encodeWithSelector(TestUSDC.AccountBlocked.selector, bob));
        usdc.mint(bob, 1e6);

        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(bob), 10e6);

        // Positive control: other accounts are unaffected, and unblocking restores both directions.
        vm.prank(alice);
        usdc.transfer(carol, 1e6);
        usdc.setBlocked(bob, false);
        vm.prank(alice);
        usdc.transfer(bob, 1e6);
        vm.prank(bob);
        usdc.transfer(alice, 2e6);
        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(bob), 9e6);
        assertEq(usdc.balanceOf(carol), 1e6);
    }
}
