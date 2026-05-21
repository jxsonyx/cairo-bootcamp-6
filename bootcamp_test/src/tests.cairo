use bootcamp_test::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};

fn ADMIN() -> ContractAddress {
    'admin'.try_into().unwrap()
}
fn RECIPIENT() -> ContractAddress {
    'recipient'.try_into().unwrap()
}
fn SPENDER() -> ContractAddress {
    'spender'.try_into().unwrap()
}
fn OTHER() -> ContractAddress {
    'other'.try_into().unwrap()
}

// u256 is serialized as two felt252s (low, high) in calldata
fn deploy() -> IERC20Dispatcher {
    let contract = declare("erc20").unwrap_syscall().contract_class();
    let (addr, _) = contract
        .deploy(@array![ADMIN().into(), RECIPIENT().into(), 1000, 0 // 1000_u256: low=1000, high=0
        ])
        .unwrap_syscall();
    IERC20Dispatcher { contract_address: addr }
}

// ── Initial state
// ────────────────────────────────────────────────────────────

#[test]
fn test_initial_state() {
    let token = deploy();
    assert(token.name() == 'Jason', 'wrong name');
    assert(token.symbol() == 'JXSN', 'wrong symbol');
    assert(token.decimals() == 18, 'wrong decimals');
    assert(token.total_supply() == 1000_u256, 'wrong supply');
    assert(token.balance_of(RECIPIENT()) == 1000_u256, 'wrong balance');
    assert(token.balance_of(OTHER()) == 0_u256, 'other balance not zero');
}

// ── transfer
// ─────────────────────────────────────────────────────────────────

#[test]
fn test_transfer() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.transfer(OTHER(), 100_u256);
    stop_cheat_caller_address(token.contract_address);
    assert(token.balance_of(RECIPIENT()) == 900_u256, 'wrong sender balance');
    assert(token.balance_of(OTHER()) == 100_u256, 'wrong recipient balance');
}

#[test]
#[should_panic(expected: ('ERC20: insufficient balance',))]
fn test_transfer_insufficient_balance() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.transfer(OTHER(), 9999_u256); // more than the 1000 minted
    stop_cheat_caller_address(token.contract_address);
}

#[test]
#[should_panic(expected: ('Spending limit exceeded',))]
fn test_transfer_exceeds_spending_limit() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.transfer(OTHER(), 10001_u256); // over MAX_LIMIT of 10000
    stop_cheat_caller_address(token.contract_address);
}

// ── approve / allowance
// ───────────────────────────────────────────────────────

#[test]
fn test_approve_and_allowance() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.approve(SPENDER(), 200_u256);
    stop_cheat_caller_address(token.contract_address);
    assert(token.allowance(RECIPIENT(), SPENDER()) == 200_u256, 'wrong allowance');
}

#[test]
fn test_increase_allowance() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.approve(SPENDER(), 100_u256);
    token.increase_allowance(SPENDER(), 50_u256);
    stop_cheat_caller_address(token.contract_address);
    assert(token.allowance(RECIPIENT(), SPENDER()) == 150_u256, 'increase failed');
}

#[test]
fn test_decrease_allowance() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.approve(SPENDER(), 100_u256);
    token.decrease_allowance(SPENDER(), 30_u256);
    stop_cheat_caller_address(token.contract_address);
    assert(token.allowance(RECIPIENT(), SPENDER()) == 70_u256, 'decrease failed');
}

#[test]
#[should_panic(expected: ('ERC20: insufficient allowance',))]
fn test_decrease_allowance_underflow() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.approve(SPENDER(), 50_u256);
    token.decrease_allowance(SPENDER(), 100_u256); // more than approved
    stop_cheat_caller_address(token.contract_address);
}

// ── transfer_from
// ─────────────────────────────────────────────────────────────

#[test]
fn test_transfer_from() {
    let token = deploy();
    // Only approve() needed — no approve_spender required anymore
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.approve(SPENDER(), 300_u256);
    stop_cheat_caller_address(token.contract_address);

    start_cheat_caller_address(token.contract_address, SPENDER());
    token.transfer_from(RECIPIENT(), OTHER(), 300_u256);
    stop_cheat_caller_address(token.contract_address);

    assert(token.balance_of(RECIPIENT()) == 700_u256, 'wrong sender balance');
    assert(token.balance_of(OTHER()) == 300_u256, 'wrong recipient balance');
    assert(token.allowance(RECIPIENT(), SPENDER()) == 0_u256, 'allowance not spent');
}

#[test]
fn test_transfer_from_partial() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.approve(SPENDER(), 300_u256);
    stop_cheat_caller_address(token.contract_address);

    start_cheat_caller_address(token.contract_address, SPENDER());
    token.transfer_from(RECIPIENT(), OTHER(), 100_u256);
    stop_cheat_caller_address(token.contract_address);

    // Remaining allowance should be decremented correctly
    assert(token.allowance(RECIPIENT(), SPENDER()) == 200_u256, 'wrong remaining allowance');
}

#[test]
#[should_panic(expected: ('ERC20: insufficient allowance',))]
fn test_transfer_from_no_allowance() {
    let token = deploy();
    // SPENDER has no allowance at all
    start_cheat_caller_address(token.contract_address, SPENDER());
    token.transfer_from(RECIPIENT(), OTHER(), 100_u256);
    stop_cheat_caller_address(token.contract_address);
}

#[test]
#[should_panic(expected: ('ERC20: insufficient allowance',))]
fn test_transfer_from_exceeds_allowance() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.approve(SPENDER(), 50_u256);
    stop_cheat_caller_address(token.contract_address);

    start_cheat_caller_address(token.contract_address, SPENDER());
    token.transfer_from(RECIPIENT(), OTHER(), 100_u256); // over the 50 approved
    stop_cheat_caller_address(token.contract_address);
}

// ── spending limit
// ────────────────────────────────────────────────────────────

#[test]
fn test_update_spending_limit() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, ADMIN());
    token.update_spending_limit(5000_u256);
    stop_cheat_caller_address(token.contract_address);
    // Verify the new limit is enforced: a transfer of exactly 5000 should pass
    // (mint extra supply to RECIPIENT first so balance is sufficient)
    start_cheat_caller_address(token.contract_address, ADMIN());
    token.mint(RECIPIENT(), 9000_u256); // RECIPIENT now has 10000
    stop_cheat_caller_address(token.contract_address);

    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.transfer(OTHER(), 5000_u256); // exactly at new limit — should pass
    stop_cheat_caller_address(token.contract_address);
}

#[test]
#[should_panic(expected: ('Only admin can call',))]
fn test_update_spending_limit_not_admin() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.update_spending_limit(500_u256);
    stop_cheat_caller_address(token.contract_address);
}

#[test]
#[should_panic(expected: ('Limit exceeds MAX_LIMIT',))]
fn test_update_spending_limit_too_high() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, ADMIN());
    token.update_spending_limit(10001_u256);
    stop_cheat_caller_address(token.contract_address);
}

// ── mint
// ──────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_by_admin() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, ADMIN());
    token.mint(OTHER(), 500_u256);
    stop_cheat_caller_address(token.contract_address);
    assert(token.balance_of(OTHER()) == 500_u256, 'wrong minted balance');
    assert(token.total_supply() == 1500_u256, 'wrong total supply');
}

#[test]
#[should_panic(expected: ('Only admin can call',))]
fn test_mint_not_admin() {
    let token = deploy();
    start_cheat_caller_address(token.contract_address, RECIPIENT());
    token.mint(OTHER(), 500_u256);
    stop_cheat_caller_address(token.contract_address);
}
