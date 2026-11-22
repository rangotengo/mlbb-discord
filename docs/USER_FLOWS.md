# DiscordDot MLBB - User Flows Guide

This guide covers all user flows for the DiscordDot MLBB tournament management bot.

## User Roles

The bot supports three main user types:

1. **Tournament Organizer (TO)** - Users with the TO role (configurable via `defaultTORole`) who manage tournaments
2. **Tournament Hosts** - Specific users assigned to host individual tournaments
3. **Players/Participants** - Regular users who participate in tournaments

---

## Player Flow

### 1. Pre-Tournament: Enrollment (Managed by TO)

Players are enrolled by the Tournament Organizer using the `!enroll` command. The TO uploads a CSV file containing player information.

**Required CSV columns:**
- `email` - Player's email address
- `name` - Player's name
- `team` - Team name
- `discord` (optional) - Player's Discord username

### 2. Tournament Verification

Players must verify their identity before participating. There are two paths:

#### Path A: Automatic Verification (Username Match)

If your Discord username, display name, or global name matches what the TO enrolled:

```
!check-in
```

**Flow:**
1. Bot searches for enrolled players matching your username in the local database
2. If found, auto-verify and assign Participant role
3. You're ready to play!

**Note:** Team roles are managed separately. Challonge brackets use team names, not individual player names.

#### Path B: Manual Verification (Email OTP)

If automatic verification fails (username doesn't match enrollment data):

```
!check-in
```

**Flow:**
1. Bot creates a private ticket channel named `ticket-{yourusername}`
2. In the ticket, use:
   ```
   !email your@email.com
   ```
3. Bot sends a 6-digit OTP to your email
4. Use the OTP to verify:
   ```
   !verify 123456
   ```
5. If successful, receive Participant role

**Important Notes:**
- Maximum 3 email attempts per player
- Tickets auto-close via button or `!close` command

### 3. During Tournament: Playing Matches

#### Finding Your Match

When a round starts, the TO creates match threads. You'll be pinged in a thread titled:
```
{Team1Name} vs {Team2Name}
```

#### Reporting Scores

After your match, report the score using:
```
!score {tournamentId} {yourScore}-{opponentScore}
```

Example:
```
!score mlbb_spring_2024 2-1
```

**Score Report Flow:**
1. Bot posts your score report
2. Pings your opponent(s)
3. Opponent can Approve or Reject via buttons
4. If approved: Score auto-pushes to Challonge (if enabled) OR sends to TO for review
5. If rejected: Discuss and report again
6. Auto-approval after 10 minutes if no response

**Important:**
- TOs use `!forcescore` instead of `!score`
- Score format must be `#-#` (e.g., `2-1`, `3-0`)
- Your score goes first

#### Path C: Manual Verification by TO

If automatic and OTP verification both fail, a TO can manually verify a player:

**Text Command:**
```
!verify-player @user player@email.com [tournamentId]
```

**Slash Command:**
```
/verify-player user:@player email:player@example.com tournament:your_tournament_id
```

**Flow:**
1. TO looks up the player by email in the enrollment data
2. Bot links the Discord account to the enrolled player record
3. Sets `verified = true` in the database
4. Assigns the configured participant role
5. Assigns the team role (or informs TO if the role needs to be created)

**Permission:** Tournament Organizer role or Administrator only

---

## Tournament Organizer Flow

### Phase 1: Pre-Tournament Setup

#### 1.1 Create Tournament on Challonge

Create your tournament on [Challonge](https://challonge.com) first.

To check teams in before a bracket exists, skip Challonge and use [pre-check-in](#pre-check-in) instead.

#### 1.2 Add Tournament to Bot

Once your tournament is created on Challonge, add it to the bot:

**Slash Command:**
```
/add tournament url:https://challonge.com/your_tournament name:your_tournament_id
```

**Text Command:**
```
!add https://challonge.com/your_tournament your_tournament_id
```

**Note:** Arguments are separated by spaces.

#### 1.3 Sync Tournament Data

After adding, sync with Challonge to fetch tournament details and players:

```
!sync your_tournament_id
```

#### 1.4 Enroll Players

Prepare a CSV file with player data:

```csv
email,name,team,discord
player1@example.com,Player One,Team Alpha,player1_discord
player2@example.com,Player Two,Team Alpha,player2_discord
player3@example.com,Player Three,Team Beta,player3_discord
```

Enroll players:
```
!enroll {tournamentId} {attach CSV file}
```

Example:
```
!enroll mlbb_spring_2024 [attach players.csv]
```

**What happens:**
- Bot parses CSV and adds players to database
- Updates existing players if email matches
- Reports count of new/updated players

### Pre-check-in

Use this when the bracket should contain only the teams that show up.

1. Create the tournament with no Challonge URL.

```
!add pre-checkin spring cup
```

The dashboard create form does the same thing when the Challonge URL is empty.

2. Enroll teams with `!enroll`.
3. Open attendance with `!precheckin open`.
4. Each team checks in with `!precheckin Team Name`. `!precheckin list` shows who is in.
5. Close attendance with `!precheckin close`.

The bot creates the Challonge tournament and adds only the checked-in teams. At least two teams are required. Run `!sync` after that to pull matches. Closing again does not create a second bracket.

#### 1.4 Enroll Players

Prepare a CSV file with player data:

```csv
email,name,team,discord
player1@example.com,Player One,Team Alpha,player1_discord
player2@example.com,Player Two,Team Alpha,player2_discord
player3@example.com,Player Three,Team Beta,player3_discord
```

Enroll players:
```
!enroll {tournamentId} {attach CSV file}
```

Example:
```
!enroll mlbb_spring_2024 [attach players.csv]
```

**What happens:**
- Bot parses CSV and adds players to database
- Updates existing players if email matches
- Reports count of new/updated players

#### 1.5 Update Individual Player Data

To update a specific player's enrollment data without re-uploading the entire CSV:

```
!update-player {email} {field}:{value} [{field2}:{value2} ...] [tournamentId]
```

**Examples:**
```
!update-player john@example.com discord:rangotengo
!update-player john@example.com discord:rangotengo team:rango
!update-player john@example.com discord:rangotengo team:rango mlbb_spring_2024
```

**Note:** You can update multiple fields in a single command. If you have multiple tournaments on the same server, include the tournament ID at the end.

**Available fields:**
- `email` - Player's email address
- `name` - Player's name
- `team` - Team name
- `discord` - Discord username

**Note:** If you have multiple tournaments on the same server, include the tournament ID as the last argument.

#### 1.6 Remove Player from Tournament

To remove a player from enrollment:

```
!drop-player {email} [tournamentId]
```

Example:
```
!drop-player john@example.com mlbb_spring_2024
```

**What happens:**
- Player is removed from the enrollment database
- If the player was verified, a warning is shown to remind you to remove their roles manually

#### 1.8 Configure Participant Role (Optional)

Set a custom participant role for your tournament (otherwise defaults to `"Participant"`):

**Slash Command:**
```
/set-participant-role tournament:your_tournament_id role:@YourRole
```

**Text Command:**
```
!set-participant-role {tournamentId} {@role}
```

**Or set it when adding the tournament:**
```
/add tournament url:https://challonge.com/xyz name:your_id participantrole:@Participant
```

#### 1.9 Add Tournament Hosts

Add additional hosts to help manage:
```
!addhost {tournamentId} {@user}
```

Example:
```
!addhost mlbb_spring_2024 @CoHost
```

Remove hosts:
```
!removehost {tournamentId} {@user}
```

#### 1.10 View Tournament Info

Check tournament details:
```
!info {tournamentId}
```

Displays:
- Tournament name and description
- Capacity and registered count
- Format
- Status
- Round 1 byes
- Hosts

#### 1.11 List All Tournaments

```
!list
```

Shows all tournaments you have access to with:
- Tournament ID
- Name
- Status
- Player count

#### 1.12 Schedule Match Times

To bulk import match schedules:

1. Create a CSV file with columns: `match_id`, `scheduled_time`, `timezone`
2. Attach the CSV and run: `!schedule [tournament_id]`
3. The command will parse the CSV and store scheduled times locally

**Example CSV:**
```csv
match_id,scheduled_time,timezone
123456,2025-03-15 18:00:00,EST
123457,2025-03-15 19:00:00,-05:00
```

**Supported date formats:**
- YYYY-MM-DD HH:MM:SS (e.g., 2025-03-15 18:00:00)
- MM/DD/YYYY HH:MM (e.g., 03/15/2025 18:00)
- DD/MM/YYYY HH:MM (e.g., 15/03/2025 18:00)

**Supported timezone formats:**
- Abbreviations: EST, PST, GMT, IST, etc.
- UTC offsets: +05:30, -08:00, +00:00
- Default: UTC if no timezone specified

### Phase 2: During Tournament

#### 2.1 Start a Round

Create match threads for a round:
```
!round {tournamentId} {channelId} {roundNumber}
```

Example:
```
!round mlbb_spring_2024 #match-threads 1
```

**Flow:**
1. Bot fetches matches from Challonge for the round
2. Shows preview of matches to be created
3. Confirm or Cancel via buttons
4. Creates threads in specified channel
5. Pings verified players in each thread

**What each thread contains:**
- Thread title: `Team1 vs Team2`
- Player mentions for both teams
- Instructions to report score

#### 2.2 Manage Score Reports

Players submit scores via `!score`. As TO, you have additional options:

**Force Submit a Score:**
```
!forcescore {tournamentId} {score} {@player}
```

Example:
```
!forcescore mlbb_spring_2024 2-1 @PlayerOne
```

This submits the score directly to Challonge, bypassing player approval.

**Review Pending Scores (if auto-push disabled):**

If `autoPushScores` is false, approved scores go to a review channel. You can:
- Click "Approve & Push" to submit to Challonge
- Click "Reject" to discard

#### 2.3 Update Tournament Details

```
!update {tournamentId} {newName} {newDescription}
```

Example:
```
!update mlbb_spring_2024 "MLBB Spring Championship 2024" "The biggest tournament yet!"
```

Updates both local database and Challonge.

#### 2.4 Sync with Challonge

If things get out of sync:
```
!sync {tournamentId}
```

Refreshes local database with latest Challonge data including:
- Tournament name/description
- Player list

### Phase 3: Post-Tournament

#### 3.1 Close Tournament

Tournaments conclude automatically when marked complete on Challonge.

#### 3.2 Clean Up Tickets

Close verification tickets manually:
```
!close
```

Or use the "Close Ticket" button in ticket channels.

---

## Slash Commands

The bot also supports Discord slash commands:

- `/add tournament` - Add a Challonge tournament to the bot
- `/timer` - Timer functionality
- `/host` - Host management
- `/update` - Update tournament
- `/info` - Tournament information
- `/list` - List tournaments
- `/thread` - Thread management
- `/invite` - Bot invite
- `/verify-player` - Manually verify a player (TO only)
- `/set-participant-role` - Configure participant role for a tournament (TO only)

### Adding a Tournament

Use `/add tournament` to add a Challonge tournament to the bot:

**Required Parameters:**
- `url` - The Challonge tournament URL (e.g., https://challonge.com/xyz)
- `name` - Custom tournament ID for the bot (e.g., mlbb_spring_2024)

**Example:**
```
/add tournament url:https://challonge.com/mlbb_spring_2024 name:mlbb_spring_2024
```

**What happens:**
- Tournament is added to the bot's database
- The tournament will be linked to the provided Challonge URL
- The user who added the tournament becomes a host

**After adding:**
Use `!sync {name}` to fetch and sync all tournament data from Challonge including:
- Tournament name and description
- Player list

**Permission:** Administrator only (slash command), Tournament Organizer role (text command)

---

## Error Handling & Troubleshooting

### Common Player Issues

**Issue:** `!check-in` says "You are a Tournament Organizer"
- **Solution:** You have the TO role and don't need to verify

**Issue:** "No pending verification found"
- **Solution:** Run `!email` first in your ticket channel

**Issue:** "Invalid OTP provided"
- **Solution:** Check your email for the correct 6-digit code

**Issue:** "No pending verification found"
- **Solution:** Run `!email` first in your ticket channel

**Issue:** "Invalid OTP provided"
- **Solution:** Check your email for the correct 6-digit code

**Issue:** "No match found for team" (during score)
- **Solution:** Contact TO to ensure your Team name on the enrollment CSV matches the Team name on the Challonge bracket exactly.

**Issue:** "Could not find an open match"
- **Solution:** Verify that the round has been started by the TO and your team has a match in this round.

### Common TO Issues

**Issue:** "Must be a Tournament Organizer"
- **Solution:** Ensure you have the configured TO role

**Issue:** CSV parsing fails
- **Solution:** Check CSV has headers: `email`, `name`, `team` (required), `discord` (optional)

**Issue:** Players can't verify
- **Solution:** Ensure players are correctly added to the enrollment CSV with their email. Verification is now handled locally by the bot.

**Issue:** Score not pushing to Challonge
- **Solution:** Check `autoPushScores` setting or use `/approve & Push` button in review channel

---

## Tournament Status States

Tournaments progress through these states:

1. **OPEN** - Registration open
2. **IPR** (In Progress/Round active) - Tournament running, scores can be submitted
3. **COMPLETE** - Tournament finished

Some commands are restricted based on status:
- Score commands require IPR status
- Update/sync blocked on COMPLETE tournaments

---

## Configuration

The bot uses these key config values:

- `defaultTORole` - Role name for Tournament Organizers (default: "TO")
- `scoreReviewChannelId` - Channel for pending score reviews
- `autoPushScores` - Auto-submit approved scores (default: true)

---

## Button Interactions

### Score Approval
- **Approve** - Confirm score and push to Challonge (or send to review)
- **Reject** - Reject score, players must resubmit

### TO Review (if auto-push disabled)
- **Approve & Push** - Submit score to Challonge
- **Reject** - Discard the score

### Tickets
- **Close Ticket** - Delete the ticket channel

---

## Command Reference

| Command | Role | Args | Description |
|---------|------|------|-------------|
| `!add` | TO | `<url> <name>` | Add Challonge tournament to bot |
| `!check-in` | Player | None | Check verification status |
| `!email` | Player | `<address>` | Request OTP via email |
| `!verify` | Player | `<otp>` | Submit OTP for verification |
| `!score` | Player | `<id> <score>` | Report match score |
| `!enroll` | TO | `<id> <csv>` | Upload player CSV |
| `!update-player` | TO | `<email> <field:value> ... [id]` | Update individual player data |
| `!drop-player` | TO | `<email> [id]` | Remove player from enrollment |
| `!sync` | TO | `<id>` | Sync with Challonge |
| `!update` | TO | `<id> <name> <desc>` | Update tournament |
| `!addhost` | TO | `<id> <@user>` | Add tournament host |
| `!removehost` | TO | `<id> <@user>` | Remove host |
| `!list` | TO | None | List tournaments |
| `!info` | All | `<id>` | Show tournament info |
| `!round` | TO | `<id> <channel> <#>` | Start round/create threads |
| `!forcescore` | TO | `<id> <score> <@user>` | Force submit score |
| `!schedule` | TO | `<id> <csv>` | Schedule match times |
| `!close` | TO | None | Close ticket channel |
| `!help` | All | None | Show help message |
| `!verify-player` | TO | `<@user> <email> [id]` | Manually verify a player |
| `!set-participant-role` | TO | `<id> <@role>` | Set participant role for tournament |
| `/verify-player` | TO | slash | Manually verify a player |
| `/set-participant-role` | TO | slash | Configure participant role |

---

## Files

- [Command Definitions](../src/commands/) - Source code for all text commands
- [Slash Commands](../src/slash/) - Source code for slash commands
- [Interaction Handler](../src/events/interaction.ts) - Button interaction handling
- [Database ORM](../src/database/orm/) - Database models
