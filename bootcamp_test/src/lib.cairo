use starknet::ContractAddress;

#[cfg(test)]
mod tests;

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    );
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256);
    fn increase_allowance(ref self: TContractState, spender: ContractAddress, added_value: u256);
    fn decrease_allowance(
        ref self: TContractState, spender: ContractAddress, subtracted_value: u256,
    );
    // ADDED: explicitly zero out a spender's allowance
    fn revoke(ref self: TContractState, spender: ContractAddress);
    fn update_spending_limit(ref self: TContractState, new_limit: u256);
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
    // ADDED: admin-only burn
    fn burn(ref self: TContractState, account: ContractAddress, amount: u256);
    fn is_frozen(self: @TContractState, account: ContractAddress) -> bool;
    // ADDED: admin can freeze/unfreeze an address — conditional transfer logic
    fn set_frozen(ref self: TContractState, account: ContractAddress, frozen: bool);
}

#[starknet::contract]
pub mod erc20 {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    const MAX_LIMIT: u256 = 10000;

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        admin: ContractAddress,
        spending_limit: u256,
        // ADDED: freeze map for conditional transfer logic
        frozen: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Copy, Drop, Debug, PartialEq, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
        Revoke: Revoke,
        Burn: Burn,
        FreezeStatus: FreezeStatus,
    }

    #[derive(Copy, Drop, Debug, PartialEq, starknet::Event)]
    pub struct Transfer {
        pub from: ContractAddress,
        pub to: ContractAddress,
        pub value: u256,
    }
    #[derive(Copy, Drop, Debug, PartialEq, starknet::Event)]
    pub struct Approval {
        pub owner: ContractAddress,
        pub spender: ContractAddress,
        pub value: u256,
    }
    #[derive(Copy, Drop, Debug, PartialEq, starknet::Event)]
    pub struct Revoke {
        pub owner: ContractAddress,
        pub spender: ContractAddress,
    }
    #[derive(Copy, Drop, Debug, PartialEq, starknet::Event)]
    pub struct Burn {
        pub account: ContractAddress,
        pub value: u256,
    }
    #[derive(Copy, Drop, Debug, PartialEq, starknet::Event)]
    pub struct FreezeStatus {
        pub account: ContractAddress,
        pub frozen: bool,
    }

    mod Errors {
        pub const APPROVE_FROM_ZERO: felt252 = 'ERC20: approve from 0';
        pub const APPROVE_TO_ZERO: felt252 = 'ERC20: approve to 0';
        pub const TRANSFER_FROM_ZERO: felt252 = 'ERC20: transfer from 0';
        pub const TRANSFER_TO_ZERO: felt252 = 'ERC20: transfer to 0';
        pub const MINT_TO_ZERO: felt252 = 'ERC20: mint to 0';
        pub const BURN_FROM_ZERO: felt252 = 'ERC20: burn from 0';
        pub const LIMIT_EXCEEDED: felt252 = 'Spending limit exceeded';
        pub const INSUFFICIENT_ALLOWANCE: felt252 = 'ERC20: insufficient allowance';
        pub const INSUFFICIENT_BALANCE: felt252 = 'ERC20: insufficient balance';
        pub const NOT_ADMIN: felt252 = 'Only admin can call';
        pub const LIMIT_TOO_HIGH: felt252 = 'Limit exceeds MAX_LIMIT';
        pub const SENDER_FROZEN: felt252 = 'Sender account is frozen';
        pub const RECIPIENT_FROZEN: felt252 = 'Recipient account is frozen';
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        recipient: ContractAddress,
        initial_supply: u256,
    ) {
        self.name.write('Jason');
        self.symbol.write('JXSN');
        self.decimals.write(18);
        self.admin.write(admin);
        self.spending_limit.write(MAX_LIMIT);
        self._mint(recipient, initial_supply);
    }

    #[abi(embed_v0)]
    impl IERC20Impl of super::IERC20<ContractState> {
        fn name(self: @ContractState) -> felt252 {
            self.name.read()
        }
        fn symbol(self: @ContractState) -> felt252 {
            self.symbol.read()
        }
        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }
        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn is_frozen(self: @ContractState, account: ContractAddress) -> bool {
            self.frozen.read(account)
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            let sender = get_caller_address();
            self._transfer(sender, recipient, amount);
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            let caller = get_caller_address();
            self.spend_allowance(sender, caller, amount);
            self._transfer(sender, recipient, amount);
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            self.approve_helper(caller, spender, amount);
        }

        fn increase_allowance(
            ref self: ContractState, spender: ContractAddress, added_value: u256,
        ) {
            let caller = get_caller_address();
            self
                .approve_helper(
                    caller, spender, self.allowances.read((caller, spender)) + added_value,
                );
        }

        fn decrease_allowance(
            ref self: ContractState, spender: ContractAddress, subtracted_value: u256,
        ) {
            let caller = get_caller_address();
            let current = self.allowances.read((caller, spender));
            assert(current >= subtracted_value, Errors::INSUFFICIENT_ALLOWANCE);
            self.approve_helper(caller, spender, current - subtracted_value);
        }

        // ADDED: revoke — owner sets a spender's allowance back to zero
        fn revoke(ref self: ContractState, spender: ContractAddress) {
            let caller = get_caller_address();
            assert(spender.is_non_zero(), Errors::APPROVE_TO_ZERO);
            self.allowances.write((caller, spender), 0);
            self.emit(Revoke { owner: caller, spender });
        }

        fn update_spending_limit(ref self: ContractState, new_limit: u256) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), Errors::NOT_ADMIN);
            assert(new_limit <= MAX_LIMIT, Errors::LIMIT_TOO_HIGH);
            self.spending_limit.write(new_limit);
        }

        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), Errors::NOT_ADMIN);
            self._mint(recipient, amount);
        }

        // ADDED: admin-only burn — destroys tokens from any account
        fn burn(ref self: ContractState, account: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), Errors::NOT_ADMIN);
            self._burn(account, amount);
        }

        // ADDED: admin can freeze an address — frozen addresses cannot send or receive
        fn set_frozen(ref self: ContractState, account: ContractAddress, frozen: bool) {
            let caller = get_caller_address();
            assert(caller == self.admin.read(), Errors::NOT_ADMIN);
            self.frozen.write(account, frozen);
            self.emit(FreezeStatus { account, frozen });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _transfer(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            // Zero address checks
            assert(sender.is_non_zero(), Errors::TRANSFER_FROM_ZERO);
            assert(recipient.is_non_zero(), Errors::TRANSFER_TO_ZERO);

            // Spending limit: amount <= MAX_LIMIT (or the admin-updated limit)
            assert(amount <= self.spending_limit.read(), Errors::LIMIT_EXCEEDED);

            // Conditional logic: neither party can be frozen
            assert(!self.frozen.read(sender), Errors::SENDER_FROZEN);
            assert(!self.frozen.read(recipient), Errors::RECIPIENT_FROZEN);

            // Balance check
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, Errors::INSUFFICIENT_BALANCE);

            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
        }

        fn spend_allowance(
            ref self: ContractState, owner: ContractAddress, spender: ContractAddress, amount: u256,
        ) {
            let allowance = self.allowances.read((owner, spender));
            assert(allowance >= amount, Errors::INSUFFICIENT_ALLOWANCE);
            self.allowances.write((owner, spender), allowance - amount);
        }

        fn approve_helper(
            ref self: ContractState, owner: ContractAddress, spender: ContractAddress, amount: u256,
        ) {
            assert(owner.is_non_zero(), Errors::APPROVE_FROM_ZERO);
            assert(spender.is_non_zero(), Errors::APPROVE_TO_ZERO);
            self.allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, value: amount });
        }

        fn _mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            assert(recipient.is_non_zero(), Errors::MINT_TO_ZERO);
            self.total_supply.write(self.total_supply.read() + amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self
                .emit(
                    Event::Transfer(Transfer { from: Zero::zero(), to: recipient, value: amount }),
                );
        }

        fn _burn(ref self: ContractState, account: ContractAddress, amount: u256) {
            assert(account.is_non_zero(), Errors::BURN_FROM_ZERO);
            let balance = self.balances.read(account);
            assert(balance >= amount, Errors::INSUFFICIENT_BALANCE);

            self.balances.write(account, balance - amount);
            self.total_supply.write(self.total_supply.read() - amount);

            // Emit Transfer to zero address — the standard convention for burns
            self.emit(Event::Transfer(Transfer { from: account, to: Zero::zero(), value: amount }));
        }
    }
}
