# Switchboard VRF Integration Guide for LuckPay

This guide explains how to integrate Switchboard VRF (Verifiable Random Function) for truly provably fair randomness in the LuckPay coin flip game.

## Current Implementation Status

✅ **COMPLETED:**
- Core game logic with escrow mechanics
- VRF-ready account structures (commented out)
- Enhanced entropy sources for demonstration
- Documentation and integration templates

🔄 **VRF INTEGRATION READY:**
- Account structures prepared for VRF accounts
- Code templates with proper VRF calls (commented)
- Error handling for randomness consumption

## Why Switchboard VRF?

The current implementation uses enhanced entropy sources (slot hashes, timestamps, bet amounts) which provides reasonable randomness for demonstration. However, for production deployment, Switchboard VRF offers:

1. **Cryptographic Security**: True verifiable randomness
2. **Transparency**: Anyone can verify the randomness source
3. **Tamper Resistance**: Impossible to manipulate or predict
4. **Industry Standard**: Used by major DeFi protocols

## Integration Steps

### 1. Dependency Management

The project already includes `switchboard-v2 = { version = "0.4.0", features = ["no-entrypoint"] }` in Cargo.toml.

### 2. Account Structure Updates

In `src/lib.rs`, uncomment the VRF account structures in `RequestRandomness` and `ResolveGame`:

```rust
#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub game: Account<'info, Game>,

    // Uncomment these VRF accounts:
    #[account(mut)]
    pub vrf_state: AccountInfo<'info>,

    #[account(mut)]
    pub vrf: AccountInfo<'info>,

    pub oracle_queue: AccountInfo<'info>,
    pub queue_authority: AccountInfo<'info>,
    pub data_buffer: AccountInfo<'info>,
    pub permission: AccountInfo<'info>,

    #[account(mut)]
    pub escrow: AccountInfo<'info>,

    pub recent_blockhashes: AccountInfo<'info>,
    pub program_state: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub switchboard_program: AccountInfo<'info>,
}
```

### 3. VRF Request Implementation

Replace the current `request_randomness` function content:

```rust
pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
    use switchboard_v2::VrfRequestRandomness;

    let game = &mut ctx.accounts.game;
    require!(game.game_state == GameState::Created, LuckPayError::InvalidGameState);

    let vrf_request = VrfRequestRandomness {
        authority: ctx.accounts.vrf_state.to_account_info(),
        vrf: ctx.accounts.vrf.to_account_info(),
        oracle_queue: ctx.accounts.oracle_queue.to_account_info(),
        queue_authority: ctx.accounts.queue_authority.to_account_info(),
        data_buffer: ctx.accounts.data_buffer.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        escrow: ctx.accounts.escrow.to_account_info(),
        payer_wallet: ctx.accounts.payer.to_account_info(),
        payer_authority: ctx.accounts.payer.to_account_info(),
        recent_blockhashes: ctx.accounts.recent_blockhashes.to_account_info(),
        program_state: ctx.accounts.program_state.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
    };

    let game_seeds = &[
        GAME_SEED,
        game.player.as_ref(),
        &[game.bump],
    ];
    let game_signer = &[&game_seeds[..]];

    vrf_request.invoke_signed(
        ctx.accounts.switchboard_program.to_account_info(),
        game_signer,
    )?;

    game.game_state = GameState::RandomnessRequested;
    game.vrf_client_state = Some(ctx.accounts.vrf.key());

    Ok(())
}
```

### 4. VRF Result Consumption

Replace the current `resolve_game` function entropy logic:

```rust
pub fn resolve_game(ctx: Context<ResolveGame>) -> Result<()> {
    use switchboard_v2::VrfAccountData;

    let game = &mut ctx.accounts.game;
    let config = &mut ctx.accounts.config;

    require!(game.game_state == GameState::RandomnessRequested, LuckPayError::InvalidGameState);

    // Load VRF result
    let vrf = VrfAccountData::new(&ctx.accounts.vrf)?;
    let result_buffer = vrf.get_result()?;
    require!(!result_buffer.is_empty(), LuckPayError::RandomnessNotReady);

    // Use VRF result for coin flip
    let random_byte = result_buffer[0];
    let coin_result = if random_byte % 2 == 0 { CoinSide::Heads } else { CoinSide::Tails };
    let player_won = coin_result == game.choice;

    // ... rest of game resolution logic
}
```

## VRF Setup Requirements

### 1. Create VRF Account

```bash
# Install Switchboard CLI
npm install -g @switchboard-xyz/cli

# Create VRF account on devnet
sbv2 solana vrf create --keypair ~/.config/solana/id.json --rpcUrl https://api.devnet.solana.com
```

### 2. Required Accounts

For each VRF request, you need:
- **VRF Account**: Stores the VRF configuration and result
- **Oracle Queue**: Manages the oracle network
- **Permission Account**: Authorizes VRF usage
- **Escrow Account**: Holds payment for oracle services
- **Program State**: Switchboard program configuration

### 3. Client Integration

Update the SDK in `sdk/luckpay-sdk.ts`:

```typescript
async requestRandomness(
    gamePda: PublicKey,
    vrfAccount: PublicKey,
    oracleQueue: PublicKey,
    // ... other VRF accounts
) {
    return await this.program.methods
        .requestRandomness()
        .accounts({
            game: gamePda,
            vrf: vrfAccount,
            oracleQueue,
            // ... other accounts
        })
        .rpc();
}
```

## Testing Strategy

### 1. Local Development
- Use enhanced entropy (current implementation)
- Test game mechanics and escrow logic

### 2. Devnet Testing
- Deploy with VRF integration
- Create test VRF accounts
- Verify randomness quality and game fairness

### 3. Mainnet Deployment
- Use production VRF configuration
- Monitor oracle performance
- Implement fallback mechanisms

## Cost Considerations

VRF requests cost approximately:
- **0.002 SOL** per VRF request on devnet
- **Variable cost** on mainnet based on oracle fees

Consider implementing:
- Minimum bet thresholds
- Fee structure to cover VRF costs
- Batch randomness for multiple games

## Security Best Practices

1. **Authority Management**: Use PDAs as VRF authorities
2. **Result Verification**: Always verify VRF results before use
3. **Timeout Handling**: Implement timeouts for VRF requests
4. **Error Recovery**: Handle VRF failures gracefully

## Migration Path

1. **Phase 1**: Deploy current implementation for testing
2. **Phase 2**: Integrate VRF on devnet
3. **Phase 3**: Production deployment with full VRF

The current codebase is structured to make this transition seamless - simply uncomment the VRF code and update the account structures.

## Resources

- [Switchboard V2 Documentation](https://docs.switchboard.xyz/)
- [VRF Examples](https://github.com/switchboard-xyz/sbv2-solana/tree/main/rust/examples)
- [Solana Foundation VRF Guide](https://github.com/solana-foundation/developer-content/blob/main/content/courses/connecting-to-offchain-data/verifiable-randomness-functions.md)

---

**Note**: The current implementation provides a solid foundation with enhanced entropy sources. VRF integration is prepared and can be activated when ready for production deployment.