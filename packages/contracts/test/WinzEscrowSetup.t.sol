// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../src/WinzEscrow.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

contract EighteenDecimals is ERC20 {
    constructor() ERC20("Eighteen", "E18") {}
}

contract NoDecimals {
    uint256 public marker = 1;
}

contract RevertingDecimals {
    function decimals() external pure returns (uint8) {
        revert("no");
    }
}

contract ShortDecimals {
    /// @dev Answers one byte instead of an ABI-encoded word.
    function decimals() external pure {
        assembly ("memory-safe") {
            mstore8(0x00, 6)
            return(0x00, 1)
        }
    }
}

/// @notice Constructor, roles, views and the EIP-712 encoding of WinzEscrow.
contract WinzEscrowSetupTest is EscrowFixture {
    // ----------------------------------------------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------------------------------------------

    function test_constructor_setsState() public view {
        assertEq(escrow.usdc(), address(usdc));
        assertEq(escrow.relayer(), relayer);
        assertEq(escrow.oracle(), oracle);
        assertEq(escrow.treasury(), treasury);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.campaignCount(), 0);
        assertEq(escrow.ticketCount(), 0);
        assertEq(escrow.EMERGENCY_DELAY(), 7 days);
        assertEq(escrow.QUOTE_TYPEHASH(), QUOTE_TYPEHASH);
    }

    function test_constructor_emitsRolesUpdated() public {
        vm.expectEmit(false, false, false, true);
        emit IWinzEscrow.RolesUpdated(relayer, oracle, treasury);
        new WinzEscrow(address(usdc), relayer, oracle, treasury, owner);
    }

    function test_constructor_acceptsSixDecimals() public {
        assertEq(usdc.decimals(), 6);
        WinzEscrow other = new WinzEscrow(address(usdc), relayer, oracle, treasury, owner);
        assertEq(other.usdc(), address(usdc));
    }

    function test_constructor_revertsOnEighteenDecimals() public {
        address token = address(new EighteenDecimals());
        vm.expectRevert(IWinzEscrow.InvalidTokenDecimals.selector);
        new WinzEscrow(token, relayer, oracle, treasury, owner);
    }

    function test_constructor_revertsOnAddressWithoutCode() public {
        vm.expectRevert(IWinzEscrow.InvalidTokenDecimals.selector);
        new WinzEscrow(makeAddr("eoa"), relayer, oracle, treasury, owner);
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(IWinzEscrow.InvalidTokenDecimals.selector);
        new WinzEscrow(address(0), relayer, oracle, treasury, owner);
    }

    function test_constructor_revertsOnTokenWithoutDecimals() public {
        address token = address(new NoDecimals());
        vm.expectRevert(IWinzEscrow.InvalidTokenDecimals.selector);
        new WinzEscrow(token, relayer, oracle, treasury, owner);
    }

    function test_constructor_revertsOnRevertingDecimals() public {
        address token = address(new RevertingDecimals());
        vm.expectRevert(IWinzEscrow.InvalidTokenDecimals.selector);
        new WinzEscrow(token, relayer, oracle, treasury, owner);
    }

    function test_constructor_revertsOnMalformedDecimals() public {
        address token = address(new ShortDecimals());
        vm.expectRevert(IWinzEscrow.InvalidTokenDecimals.selector);
        new WinzEscrow(token, relayer, oracle, treasury, owner);
    }

    function test_constructor_revertsOnZeroRelayer() public {
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        new WinzEscrow(address(usdc), address(0), oracle, treasury, owner);
    }

    function test_constructor_revertsOnZeroOracle() public {
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        new WinzEscrow(address(usdc), relayer, address(0), treasury, owner);
    }

    function test_constructor_revertsOnZeroTreasury() public {
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        new WinzEscrow(address(usdc), relayer, oracle, address(0), owner);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new WinzEscrow(address(usdc), relayer, oracle, treasury, address(0));
    }

    /// @dev Spec, hypothesis for the hackathon: the treasury is the relayer's own account.
    function test_constructor_allowsRelayerAsTreasury() public {
        WinzEscrow other = new WinzEscrow(address(usdc), relayer, oracle, relayer, owner);
        assertEq(other.treasury(), relayer);
        assertEq(other.relayer(), relayer);
    }

    // ----------------------------------------------------------------------------------------------
    // setRoles
    // ----------------------------------------------------------------------------------------------

    function test_setRoles_updatesAndEmits() public {
        address newRelayer = makeAddr("newRelayer");
        address newOracle = makeAddr("newOracle");
        address newTreasury = makeAddr("newTreasury");

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.RolesUpdated(newRelayer, newOracle, newTreasury);
        vm.prank(owner);
        escrow.setRoles(newRelayer, newOracle, newTreasury);

        assertEq(escrow.relayer(), newRelayer);
        assertEq(escrow.oracle(), newOracle);
        assertEq(escrow.treasury(), newTreasury);
    }

    function test_setRoles_revertsForNonOwner() public {
        address[4] memory callers = [relayer, oracle, treasury, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, callers[i]));
            vm.prank(callers[i]);
            escrow.setRoles(relayer, oracle, treasury);
        }
    }

    function test_setRoles_revertsOnZeroRelayer() public {
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(owner);
        escrow.setRoles(address(0), oracle, treasury);
    }

    function test_setRoles_revertsOnZeroOracle() public {
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(owner);
        escrow.setRoles(relayer, address(0), treasury);
    }

    function test_setRoles_revertsOnZeroTreasury() public {
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(owner);
        escrow.setRoles(relayer, oracle, address(0));
    }

    function test_setRoles_revertsWhenTreasuryIsTheEscrow() public {
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(owner);
        escrow.setRoles(relayer, oracle, address(escrow));
    }

    function test_setRoles_oldRelayerLosesAccess_newRelayerGainsIt() public {
        address newRelayer = makeAddr("newRelayer");
        vm.prank(owner);
        escrow.setRoles(newRelayer, oracle, treasury);

        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 10_000);

        vm.expectRevert(IWinzEscrow.Unauthorized.selector);
        vm.prank(relayer);
        escrow.createCampaignFor(joe, params, 0);

        vm.prank(newRelayer);
        assertEq(escrow.createCampaignFor(joe, params, 0), 1);
    }

    function test_setRoles_oldOracleQuotesAreRefused_newOracleQuotesPass() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory oldQuote = _quote(id, maya, 1, ONE);
        bytes memory oldSig = _sign(oldQuote);

        (address newOracle, uint256 newOracleKey) = makeAddrAndKey("newOracle");
        vm.prank(owner);
        escrow.setRoles(relayer, newOracle, treasury);

        vm.expectRevert(IWinzEscrow.QuoteBadSignature.selector);
        vm.prank(relayer);
        escrow.buyFor(oldQuote, oldSig);

        vm.expectRevert(IWinzEscrow.Unauthorized.selector);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.No);

        bytes memory newSig = _signDigest(_digest(oldQuote), newOracleKey);
        vm.prank(relayer);
        assertEq(escrow.buyFor(oldQuote, newSig), 1);
    }

    function test_setRoles_newTreasuryPaysAndReceives() public {
        uint64 id = _createJoe();
        address newTreasury = makeAddr("newTreasury");
        usdc.mint(newTreasury, 100 * ONE);
        vm.prank(newTreasury);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(owner);
        escrow.setRoles(relayer, oracle, newTreasury);

        uint256 oldTreasuryBefore = usdc.balanceOf(treasury);
        uint256 ticketId = _buyFor(id, maya, 1, 3 * ONE);
        assertEq(usdc.balanceOf(newTreasury), 80 * ONE, "new treasury paid the purchase");
        assertEq(usdc.balanceOf(treasury), oldTreasuryBefore, "old treasury untouched");

        _charge(ticketId, 2 * ONE);
        assertEq(usdc.balanceOf(newTreasury), 82 * ONE, "new treasury received the hedge cost");
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------------------------------

    function test_getCampaign_revertsForUnknownId() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.getCampaign(0);
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.getCampaign(1);

        _createJoe();
        assertEq(escrow.getCampaign(1).merchant, joe);
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.getCampaign(2);
    }

    function test_getTicket_revertsForUnknownId() public {
        vm.expectRevert(IWinzEscrow.TicketNotFound.selector);
        escrow.getTicket(0);
        vm.expectRevert(IWinzEscrow.TicketNotFound.selector);
        escrow.getTicket(1);

        uint64 id = _createJoe();
        _buyFor(id, maya, 1, ONE);
        assertEq(escrow.getTicket(1).buyer, maya);
        vm.expectRevert(IWinzEscrow.TicketNotFound.selector);
        escrow.getTicket(2);
    }

    function test_availableBudget_followsReservationsAndCharges() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.availableBudget(1);

        uint64 id = _createJoe();
        assertEq(escrow.availableBudget(id), 1_000 * ONE);

        uint256 ticketId = _buyFor(id, maya, 1, 3 * ONE);
        assertEq(escrow.availableBudget(id), 997 * ONE, "reserved at purchase");

        _charge(ticketId, 2 * ONE);
        assertEq(escrow.availableBudget(id), 998 * ONE, "unused part of the reservation is back");

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(escrow.availableBudget(id), c.hedgeBudget - c.hedgeSpent - c.hedgeReserved);
    }

    // ----------------------------------------------------------------------------------------------
    // EIP-712
    // ----------------------------------------------------------------------------------------------

    function test_eip712Domain_isWinzEscrowV1() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            escrow.eip712Domain();
        assertEq(name, "WinzEscrow");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(escrow));
    }

    function testFuzz_quoteDigest_matchesSpecEncoding(
        uint64 campaignId,
        address buyer,
        uint32 qty,
        uint128 maxHedgeCost,
        uint64 expiry,
        uint256 nonce
    ) public view {
        IWinzEscrow.Quote memory q = IWinzEscrow.Quote(campaignId, buyer, qty, maxHedgeCost, expiry, nonce);
        assertEq(escrow.quoteDigest(q), _digest(q));
    }

    function test_quoteDigest_dependsOnEveryField() public view {
        IWinzEscrow.Quote memory base = IWinzEscrow.Quote(1, maya, 2, 3, 4, 5);
        bytes32 digest = escrow.quoteDigest(base);

        IWinzEscrow.Quote memory q = IWinzEscrow.Quote(9, maya, 2, 3, 4, 5);
        assertTrue(escrow.quoteDigest(q) != digest, "campaignId");
        q = IWinzEscrow.Quote(1, liam, 2, 3, 4, 5);
        assertTrue(escrow.quoteDigest(q) != digest, "buyer");
        q = IWinzEscrow.Quote(1, maya, 9, 3, 4, 5);
        assertTrue(escrow.quoteDigest(q) != digest, "qty");
        q = IWinzEscrow.Quote(1, maya, 2, 9, 4, 5);
        assertTrue(escrow.quoteDigest(q) != digest, "maxHedgeCost");
        q = IWinzEscrow.Quote(1, maya, 2, 3, 9, 5);
        assertTrue(escrow.quoteDigest(q) != digest, "expiry");
        q = IWinzEscrow.Quote(1, maya, 2, 3, 4, 9);
        assertTrue(escrow.quoteDigest(q) != digest, "nonce");
    }

    function test_quoteDigest_isBoundToContractAndChain() public {
        IWinzEscrow.Quote memory q = IWinzEscrow.Quote(1, maya, 2, 3, 4, 5);
        bytes32 digest = escrow.quoteDigest(q);

        WinzEscrow other = new WinzEscrow(address(usdc), relayer, oracle, treasury, owner);
        assertTrue(other.quoteDigest(q) != digest, "other contract");

        vm.chainId(block.chainid + 1);
        assertTrue(escrow.quoteDigest(q) != digest, "other chain");
        assertEq(escrow.quoteDigest(q), _digest(q), "still the spec encoding on the new chain");
    }
}
