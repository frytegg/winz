// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";

/// @notice Proves the toolchain resolves forge-std and OpenZeppelin, and pins the enum order the
///         TypeScript side maps by index.
contract ToolchainTest is Test {
    function test_enumOrderMatchesOffchainMapping() public pure {
        assertEq(uint8(IWinzEscrow.Status.Live), 0);
        assertEq(uint8(IWinzEscrow.Status.Paused), 1);
        assertEq(uint8(IWinzEscrow.Status.SettledYes), 2);
        assertEq(uint8(IWinzEscrow.Status.SettledNo), 3);
        assertEq(uint8(IWinzEscrow.Status.Void), 4);
        assertEq(uint8(IWinzEscrow.Outcome.Yes), 0);
        assertEq(uint8(IWinzEscrow.Outcome.No), 1);
        assertEq(uint8(IWinzEscrow.Outcome.Void), 2);
    }

    function test_dependenciesResolve() public {
        assertEq(IERC20.transfer.selector, bytes4(0xa9059cbb));
        (address signer, uint256 key) = makeAddrAndKey("signer");
        bytes32 digest = keccak256("winz");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        assertEq(ECDSA.recover(digest, v, r, s), signer);
    }
}
