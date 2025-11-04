use anchor_lang::prelude::*;

declare_id!("5pDvSp5GGScmM4Wy3YK5mioe91mPMs62CoC8w2ps7KeP");

const GAME_SEED: &[u8] = b"game";
const CONFIG_SEED: &[u8] = b"config";
const TREASURY_SEED: &[u8] = b"treasury";

#[program]
pub mod luckpay {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_bet_amount: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.house_edge = 500; // Hardcoded 5% house edge (500 basis points)
        config.max_bet_amount = max_bet_amount;
        config.total_games = 0;
        config.total_volume = 0;
        config.bump = ctx.bumps.config;

        msg!("LuckPay config initialized with house edge: 5% (500bp), max bet: {} lamports", max_bet_amount);
        Ok(())
    }

    pub fn create_game(
        ctx: Context<CreateGame>,
        send_amount: u64, // Amount to send to recipient
        recipient: Pubkey,
        choice: CoinSide, // 0 = heads, 1 = tails
        risk_percentage: u8, // 0-100, affects win probability, not payment
    ) -> Result<()> {
        require!(send_amount > 0, LuckPayError::InvalidBetAmount);
        require!(send_amount <= ctx.accounts.config.max_bet_amount, LuckPayError::BetTooHigh);

        // Store keys before borrowing
        let player_key = ctx.accounts.player.key();
        let game_key = ctx.accounts.game.key();

        let clock = Clock::get()?;

        // Calculate escrow amount (always double the send amount)
        let escrow_amount = send_amount * 2;

        // Lock the full escrow amount (2x) from player upfront to treasury
        // Treasury PDA has no data, so transfers work properly
        let (treasury_pda, _treasury_bump) = Pubkey::find_program_address(
            &[TREASURY_SEED],
            ctx.program_id
        );

        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(
                &player_key,
                &treasury_pda,
                escrow_amount,
            ),
            &[
                ctx.accounts.player.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        msg!("Escrow locked: {} lamports transferred to protocol treasury", escrow_amount);

        let game = &mut ctx.accounts.game;
        game.player = player_key;
        game.recipient = recipient;
        game.bet_amount = send_amount; // This is the amount to send, not bet
        game.choice = choice;
        game.discount_percentage = risk_percentage; // Rename to reflect its real purpose
        game.game_state = GameState::Created;
        game.created_at = clock.unix_timestamp;
        game.bump = ctx.bumps.game;
        game.vrf_client_state = None;
        game.result = None;

        msg!("Game created: player={}, recipient={}, send_amount={}, escrow_locked={}, choice={:?}, risk={}%",
             game.player, game.recipient, send_amount, escrow_amount, game.choice, risk_percentage);

        Ok(())
    }

    /// Request randomness for the coin flip
    ///
    /// SWITCHBOARD VRF INTEGRATION READY:
    /// This function is structured to easily integrate with Switchboard VRF.
    /// For production, replace the slot hash approach with proper VRF calls.
    ///
    /// Current implementation uses slot hashes for demonstration.
    /// Account structure is already prepared for Switchboard VRF.
    pub fn request_randomness(
        ctx: Context<RequestRandomness>,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.game_state == GameState::Created, LuckPayError::InvalidGameState);

        // Current approach: Use slot hash + timestamp for entropy
        let clock = Clock::get()?;

        // TODO: Replace with Switchboard VRF request
        // Example VRF integration code (commented out for now):
        /*
        use switchboard_v2::{VrfRequestRandomness};

        let vrf_request = VrfRequestRandomness {
            authority: ctx.accounts.vrf_state.to_account_info(),
            vrf: ctx.accounts.vrf.to_account_info(),
            oracle_queue: ctx.accounts.oracle_queue.to_account_info(),
            // ... other accounts
        };

        vrf_request.invoke_signed(
            ctx.accounts.switchboard_program.to_account_info(),
            game_signer,
        )?;
        */

        msg!("Requesting randomness for game at slot: {}", clock.slot);

        game.game_state = GameState::RandomnessRequested;
        // Store slot info for entropy (will be replaced by VRF account in production)
        game.vrf_client_state = Some(Pubkey::new_from_array([
            (clock.slot & 0xFF) as u8,
            ((clock.slot >> 8) & 0xFF) as u8,
            ((clock.slot >> 16) & 0xFF) as u8,
            ((clock.slot >> 24) & 0xFF) as u8,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ]));

        Ok(())
    }

    /// Resolve the coin flip game using randomness
    ///
    /// SWITCHBOARD VRF INTEGRATION READY:
    /// This function is structured to easily consume VRF results.
    /// Current implementation uses enhanced entropy for demonstration.
    pub fn resolve_game(ctx: Context<ResolveGame>) -> Result<()> {
        // Store keys and account info before borrowing mutably
        let game_key = ctx.accounts.game.key();
        let game_account_info = ctx.accounts.game.to_account_info();
        let config_key = ctx.accounts.config.key();
        let config_account_info = ctx.accounts.config.to_account_info();

        let game = &mut ctx.accounts.game;
        let config = &mut ctx.accounts.config;

        require!(game.game_state == GameState::RandomnessRequested, LuckPayError::InvalidGameState);

        // Enhanced entropy sources for better randomness:
        let request_slot_bytes = game.vrf_client_state.unwrap().to_bytes();
        let request_slot = u32::from_le_bytes([
            request_slot_bytes[0],
            request_slot_bytes[1],
            request_slot_bytes[2],
            request_slot_bytes[3],
        ]);

        let clock = Clock::get()?;
        let current_slot = clock.slot;
        let timestamp = clock.unix_timestamp;

        // Combine multiple entropy sources
        let entropy = (request_slot as u64)
            .wrapping_mul(current_slot)
            .wrapping_add(timestamp as u64)
            .wrapping_add(game.bet_amount);

        let random_byte = (entropy % 256) as u8;

        // Store values before calculating win logic
        let bet_amount = game.bet_amount;
        let recipient = game.recipient;
        let player = game.player;
        let game_bump = game.bump;
        let risk_percentage = game.discount_percentage as u64;

        // Apply house edge: base win rate is 47.5% (not 50%)
        // Risk percentage modifies this base rate
        let base_win_threshold: u16 = 121; // 47.5% of 256 (5% house edge built in)

        let win_threshold: u8 = match risk_percentage {
            0..=25 => (base_win_threshold / 2) as u8,      // ~23.75% win chance (very conservative)
            26..=50 => ((base_win_threshold * 3) / 4) as u8, // ~35.6% win chance (conservative)
            51..=75 => base_win_threshold as u8,         // ~47.5% win chance (standard)
            76..=100 => {
                let result = (base_win_threshold * 5) / 4;
                if result > 255 { 255 } else { result as u8 } // Cap at 255 to prevent overflow
            }, // ~59.4% win chance (aggressive)
            _ => base_win_threshold as u8, // Default to 47.5%
        };

        // UNIFIED WIN LOGIC: Use house edge + risk percentage for BOTH coin result AND transfers
        let player_won = random_byte < win_threshold;

        // Determine coin flip result for display (but actual win is based on house edge)
        let coin_result = if random_byte % 2 == 0 { CoinSide::Heads } else { CoinSide::Tails };

        game.result = Some(GameResult {
            coin_result,
            player_won, // This now matches the actual transfer logic
            random_value: random_byte,
        });
        game.game_state = GameState::Resolved;

        // Update global stats
        config.total_games = config.total_games.checked_add(1).unwrap();
        config.total_volume = config.total_volume.checked_add(game.bet_amount).unwrap();

        let send_amount = bet_amount; // Amount to send to recipient
        let escrow_amount = send_amount * 2; // Total locked amount

        // Prepare treasury PDA signer for transferring from escrow
        let (treasury_pda, treasury_bump) = Pubkey::find_program_address(
            &[TREASURY_SEED],
            ctx.program_id
        );
        let treasury_seeds = &[
            TREASURY_SEED,
            &[treasury_bump],
        ];
        let treasury_signer = &[&treasury_seeds[..]];

        // Check treasury balance before attempting transfers
        let treasury_balance = ctx.accounts.treasury.lamports();
        let required_for_recipient = send_amount;
        let required_for_refund = if player_won { escrow_amount } else { 0 };
        let total_required = required_for_recipient + required_for_refund;

        require!(treasury_balance >= total_required, LuckPayError::InsufficientEscrowBalance);

        msg!("Treasury balance: {}, required: {} (recipient: {}, refund: {})",
             treasury_balance, total_required, required_for_recipient, required_for_refund);

        if player_won {
            // Player wins: Send amount to recipient from escrow + return remainder to player

            // Send amount to recipient from treasury escrow
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &treasury_pda,
                    &ctx.accounts.recipient.key(),
                    send_amount,
                ),
                &[
                    ctx.accounts.treasury.to_account_info(),
                    ctx.accounts.recipient.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                treasury_signer,
            )?;

            // Return full escrow to player (FREE transfer when winning)
            let refund_amount = escrow_amount; // Return the full 2x amount locked
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &treasury_pda,
                    &ctx.accounts.player_account.key(),
                    refund_amount,
                ),
                &[
                    ctx.accounts.treasury.to_account_info(),
                    ctx.accounts.player_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                treasury_signer,
            )?;

            msg!("Player WON! Sent {} to recipient from escrow, returned {} to player. Total escrow used: {}. Risk: {}%, Random: {}",
                 send_amount, refund_amount, escrow_amount, risk_percentage, random_byte);

        } else {
            // Player loses: Send amount to recipient from escrow + protocol keeps remainder as fee

            // Send amount to recipient from treasury escrow
            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &treasury_pda,
                    &ctx.accounts.recipient.key(),
                    send_amount,
                ),
                &[
                    ctx.accounts.treasury.to_account_info(),
                    ctx.accounts.recipient.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                treasury_signer,
            )?;

            // Protocol keeps the remaining amount as fee (stays in config)
            let protocol_fee = send_amount;

            msg!("Player LOST! Sent {} to recipient from escrow, protocol earned {} fee. Total escrow: {}. Risk: {}%, Random: {}",
                 send_amount, protocol_fee, escrow_amount, risk_percentage, random_byte);
        }

        // Auto-close the game account to reclaim rent (no separate transaction needed)
        msg!("Game completed and account closed automatically");

        Ok(())
    }

    pub fn close_game(ctx: Context<CloseGame>) -> Result<()> {
        let game = &ctx.accounts.game;
        require!(game.game_state == GameState::Resolved, LuckPayError::InvalidGameState);

        msg!("Game closed and account rent reclaimed");
        Ok(())
    }

}

#[derive(Accounts)]
#[instruction(max_bet_amount: u64)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(bet_amount: u64, recipient: Pubkey, choice: CoinSide, discount_percentage: u8)]
pub struct CreateGame<'info> {
    #[account(
        init,
        payer = player,
        space = 8 + Game::INIT_SPACE,
        seeds = [GAME_SEED, player.key().as_ref()],
        bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub player: Signer<'info>,

    /// CHECK: Treasury PDA for holding escrow funds (no data, just SOL)
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, game.player.as_ref()],
        bump = game.bump
    )]
    pub game: Account<'info, Game>,

    /// CHECK: Player who requested the game (for signing)
    pub player: Signer<'info>,

    // VRF-ready account structure (optional for current implementation)
    // Uncomment these when implementing full Switchboard VRF:

    // /// CHECK: VRF State account (authority for VRF requests)
    // #[account(mut)]
    // pub vrf_state: AccountInfo<'info>,

    // /// CHECK: Switchboard VRF account
    // #[account(mut)]
    // pub vrf: AccountInfo<'info>,

    // /// CHECK: Switchboard Oracle Queue account
    // pub oracle_queue: AccountInfo<'info>,

    // /// CHECK: Switchboard Queue Authority
    // pub queue_authority: AccountInfo<'info>,

    // /// CHECK: Switchboard Data Buffer
    // pub data_buffer: AccountInfo<'info>,

    // /// CHECK: Switchboard Permission account
    // pub permission: AccountInfo<'info>,

    // /// CHECK: Switchboard Escrow account
    // #[account(mut)]
    // pub escrow: AccountInfo<'info>,

    // /// CHECK: Recent blockhashes sysvar
    // pub recent_blockhashes: AccountInfo<'info>,

    // /// CHECK: Switchboard program state
    // pub program_state: AccountInfo<'info>,

    // /// CHECK: Token program
    // pub token_program: AccountInfo<'info>,

    // /// CHECK: Switchboard program
    // pub switchboard_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ResolveGame<'info> {
    #[account(
        mut,
        close = player_account, // Auto-close and send rent to player
        seeds = [GAME_SEED, game.player.as_ref()],
        bump = game.bump
    )]
    pub game: Account<'info, Game>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    // /// CHECK: Switchboard VRF account (uncomment for VRF integration)
    // pub vrf: AccountInfo<'info>,

    /// CHECK: Player account to receive refund if won
    #[account(mut)]
    pub player_account: AccountInfo<'info>,

    /// CHECK: Recipient account
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    /// CHECK: Treasury PDA for holding escrow funds
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseGame<'info> {
    #[account(
        mut,
        close = player,
        seeds = [GAME_SEED, game.player.as_ref()],
        bump = game.bump,
        constraint = game.player == player.key()
    )]
    pub game: Account<'info, Game>,

    #[account(mut)]
    pub player: Signer<'info>,
}


#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub house_edge: u16, // basis points
    pub max_bet_amount: u64,
    pub total_games: u64,
    pub total_volume: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Game {
    pub player: Pubkey,
    pub recipient: Pubkey,
    pub bet_amount: u64,
    pub choice: CoinSide,
    pub discount_percentage: u8, // 0-100, where 100 = free, 50 = 50% discount
    pub game_state: GameState,
    pub created_at: i64,
    pub vrf_client_state: Option<Pubkey>,
    pub result: Option<GameResult>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace, Debug)]
pub enum CoinSide {
    Heads,
    Tails,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum GameState {
    Created,
    RandomnessRequested,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct GameResult {
    pub coin_result: CoinSide,
    pub player_won: bool,
    pub random_value: u8,
}

#[error_code]
pub enum LuckPayError {
    #[msg("Invalid bet amount")]
    InvalidBetAmount,
    #[msg("Bet amount exceeds maximum allowed")]
    BetTooHigh,
    #[msg("Invalid game state for this operation")]
    InvalidGameState,
    #[msg("Randomness not ready")]
    RandomnessNotReady,
    #[msg("Insufficient balance in escrow treasury")]
    InsufficientEscrowBalance,
}
