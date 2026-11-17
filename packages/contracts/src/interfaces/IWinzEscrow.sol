// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWinzEscrow
/// @notice Escrow for "refunded if the team wins" promotions, settled in USDC on Arc.
/// @dev All amounts are micro-USDC (ERC-20 interface of USDC, 6 decimals). The native 18-decimal
///      balance is never used. Nobody but Winz keys ever needs to send a transaction: functions that
///      benefit a merchant or a customer are either relayer-only or open to anyone with a
///      beneficiary fixed by the contract.
interface IWinzEscrow {
    // ----------------------------------------------------------------------------------------------
    // Types
    // ----------------------------------------------------------------------------------------------

    /// @notice On-chain status. "Sales closed" is derived from `salesClose`, never stored.
    enum Status {
        Live,
        Paused,
        SettledYes,
        SettledNo,
        Void
    }

    /// @notice Result of the condition, as reported by the oracle.
    enum Outcome {
        Yes,
        No,
        Void
    }

    /// @param instrument keccak256 of the Gemini `instrumentSymbol` (symbols are longer than 32 bytes).
    /// @param salesClose Unix time after which no ticket can be sold.
    /// @param unitPrice Price of one unit, micro-USDC.
    /// @param refundBps Share of the price refunded on YES, in basis points. Immutable.
    struct CampaignParams {
        bytes32 instrument;
        uint64 salesClose;
        uint128 unitPrice;
        uint16 refundBps;
    }

    /// @param hedgeBudget Total hedge budget deposited.
    /// @param hedgeReserved Sum of `maxHedgeCost` of tickets not charged yet.
    /// @param hedgeSpent Sum actually charged.
    /// @param lockedRefunds Sum of `refundable` of tickets not paid out.
    /// @param merchantDue Owed by the treasury after settlement (YES: exposure, VOID: hedge spent).
    /// @param released True once the remaining budget (and escrow, on NO or VOID) went to the merchant.
    struct Campaign {
        address merchant;
        bytes32 instrument;
        uint64 salesClose;
        uint128 unitPrice;
        uint16 refundBps;
        uint128 hedgeBudget;
        uint128 hedgeReserved;
        uint128 hedgeSpent;
        uint128 lockedRefunds;
        uint128 merchantDue;
        Status status;
        bool released;
    }

    struct Ticket {
        uint64 campaignId;
        address buyer;
        uint128 paid;
        uint128 refundable;
        uint128 maxHedgeCost;
        bool hedgeCharged;
        bool paidOut;
    }

    /// @notice Hedge-cost guarantee for one purchase, signed by the oracle (EIP-712).
    /// @dev EIP-712 domain: name "WinzEscrow", version "1", this chain, this contract.
    /// @param maxHedgeCost Most the merchant can ever be charged for hedging this purchase.
    /// @param expiry Unix time after which the quote is refused.
    /// @param nonce Unique per quote; a nonce can be used once.
    struct Quote {
        uint64 campaignId;
        address buyer;
        uint32 qty;
        uint128 maxHedgeCost;
        uint64 expiry;
        uint256 nonce;
    }

    // ----------------------------------------------------------------------------------------------
    // Events
    // ----------------------------------------------------------------------------------------------

    event CampaignCreated(
        uint64 indexed id,
        address indexed merchant,
        bytes32 indexed instrument,
        uint16 refundBps,
        uint64 salesClose,
        uint128 unitPrice,
        uint128 budget
    );
    event BudgetToppedUp(uint64 indexed id, uint128 amount);
    event TicketPurchased(
        uint256 indexed ticketId,
        uint64 indexed id,
        address indexed buyer,
        uint32 qty,
        uint128 paid,
        uint128 refundable,
        uint128 maxHedgeCost
    );
    event CampaignPaused(uint64 indexed id, bool paused);
    event SalesClosedEarly(uint64 indexed id, uint64 salesClose);
    event HedgeCharged(uint256 indexed ticketId, uint64 indexed id, uint128 amount);
    event CampaignSettled(uint64 indexed id, Outcome outcome, uint128 merchantDue);
    event MerchantPaid(uint64 indexed id, uint128 amount);
    event TicketRefunded(uint256 indexed ticketId, uint64 indexed id, address indexed buyer, uint128 amount);
    event RefundFailed(uint256 indexed ticketId, uint64 indexed id);
    event CampaignReleased(uint64 indexed id, uint128 amount);
    event RolesUpdated(address relayer, address oracle, address treasury);

    // ----------------------------------------------------------------------------------------------
    // Errors
    // ----------------------------------------------------------------------------------------------

    error Unauthorized();
    error InvalidParams();
    error InvalidTokenDecimals();
    error CampaignNotFound();
    error TicketNotFound();
    error SalesAreClosed();
    error SalesArePaused();
    error SalesStillOpen();
    error QuoteExpired();
    error QuoteNonceUsed();
    error QuoteBadSignature();
    error QuoteMismatch();
    error BudgetExceeded();
    error HedgeAlreadyCharged();
    error HedgeAboveGuarantee();
    error HedgeNotFinalized();
    error AlreadySettled();
    error NotSettled();
    error WrongOutcome();
    error AlreadyReleased();
    error NothingDue();
    error AlreadyPaidOut();
    error EmergencyNotActive();
    error EmergencyActive();
    error LengthMismatch();

    // ----------------------------------------------------------------------------------------------
    // Relayer
    // ----------------------------------------------------------------------------------------------

    /// @notice Creates a campaign for `merchant` and pulls its hedge budget from the treasury.
    /// @dev Reverts with InvalidParams if merchant is zero, unitPrice is zero, refundBps is zero or
    ///      above 10_000, or salesClose is not in the future.
    /// @return id The new campaign id (starts at 1).
    function createCampaignFor(address merchant, CampaignParams calldata params, uint128 budget)
        external
        returns (uint64 id);

    /// @notice Adds hedge budget from the treasury to a campaign that is neither settled nor released.
    function topUpBudgetFor(uint64 id, uint128 amount) external;

    /// @notice Buys `quote.qty` units for `quote.buyer`, paid by the treasury.
    /// @dev Verifies the oracle's signature, expiry and nonce; requires the campaign to be Live and
    ///      before `salesClose`; requires `quote.maxHedgeCost` to fit in the available budget and
    ///      reserves it; pulls `qty * unitPrice` from the treasury, keeps the refundable part and
    ///      forwards the rest to the merchant.
    /// @return ticketId The new ticket id (starts at 1).
    function buyFor(Quote calldata quote, bytes calldata signature) external returns (uint256 ticketId);

    /// @notice Manual pause or resume asked by the merchant. Refused after `salesClose` or settlement.
    function setPaused(uint64 id, bool paused) external;

    /// @notice Ends sales now, at the merchant's request. Can only move `salesClose` earlier.
    function closeSales(uint64 id) external;

    // ----------------------------------------------------------------------------------------------
    // Customer (optional direct path)
    // ----------------------------------------------------------------------------------------------

    /// @notice Same as `buyFor`, but paid by the caller, who must be `quote.buyer`.
    function buy(Quote calldata quote, bytes calldata signature) external returns (uint256 ticketId);

    // ----------------------------------------------------------------------------------------------
    // Oracle
    // ----------------------------------------------------------------------------------------------

    /// @notice Charges the hedge cost of tickets to their campaign budgets and sends it to the treasury.
    /// @dev Each ticket can be charged once, before settlement, for at most its `maxHedgeCost`; the
    ///      unused part of the reservation returns to the available budget. An amount of zero is valid
    ///      and only releases the reservation.
    function chargeHedge(uint256[] calldata ticketIds, uint128[] calldata amounts) external;

    /// @notice Records the outcome, once, after `salesClose`, and only when every ticket of the
    ///         campaign has been charged (`hedgeReserved == 0`). Refused once the emergency window
    ///         is open.
    /// @dev Sets `merchantDue`: YES → `lockedRefunds` at that time, VOID → `hedgeSpent`, NO → 0.
    function settle(uint64 id, Outcome outcome) external;

    // ----------------------------------------------------------------------------------------------
    // Anyone
    // ----------------------------------------------------------------------------------------------

    /// @notice Pulls `merchantDue` from the treasury and pays it to the merchant.
    /// @dev Separate from `settle` so that an empty treasury can never block a settlement or a refund.
    function payMerchant(uint64 id) external;

    /// @notice Refunds tickets of a campaign settled YES to their buyers, from the escrow.
    /// @dev Tickets already paid, or belonging to another campaign, are skipped. A transfer that
    ///      fails (for example a blocklisted buyer) emits RefundFailed and leaves the ticket owed;
    ///      it never reverts the batch.
    function refundBatch(uint64 id, uint256[] calldata ticketIds) external;

    /// @notice After settlement, once: sends the merchant the unspent budget, plus the escrow on NO
    ///         or VOID.
    function release(uint64 id) external;

    /// @notice Seven days after `salesClose` without settlement: pays the refundable amount of a
    ///         ticket to its buyer.
    function emergencyClaim(uint256 ticketId) external;

    /// @notice Same delay: returns the unspent budget, reservations included, to the merchant.
    function emergencyReleaseBudget(uint64 id) external;

    // ----------------------------------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------------------------------

    function getCampaign(uint64 id) external view returns (Campaign memory);

    function getTicket(uint256 ticketId) external view returns (Ticket memory);

    /// @notice `hedgeBudget - hedgeSpent - hedgeReserved`.
    function availableBudget(uint64 id) external view returns (uint128);

    /// @notice EIP-712 digest the oracle must sign for `quote`.
    function quoteDigest(Quote calldata quote) external view returns (bytes32);

    function nonceUsed(uint256 nonce) external view returns (bool);

    function campaignCount() external view returns (uint64);

    function ticketCount() external view returns (uint256);

    function usdc() external view returns (address);

    function relayer() external view returns (address);

    function oracle() external view returns (address);

    function treasury() external view returns (address);

    /// @notice Delay after `salesClose` before the emergency exits open (7 days).
    function EMERGENCY_DELAY() external view returns (uint64);
}
