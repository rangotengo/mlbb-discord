<!-- # Dot [<img src="https://img.shields.io/static/v1?label=invite%20to&message=Discord&color=informational&style=for-the-badge" alt="Invite to Discord" align="right" />](https://discord.com/api/oauth2/authorize?client_id=691882968809209917&permissions=275146467392&scope=bot) -->


A Discord bot to facilitate organising Mobile Legends tournaments online using [Challengermode](https://www.challengermode.com/).

Dot automates the tedious tasks of the sign-up process, email verification, and organising match threads for tournament hosts. Tournament data comes from Challengermode.
This frees up hosts to focus on the overall flow of the tournament and any disputes instead of a lot of repetitive work.
The integration reads tournament details, teams, fixtures, rounds, and scheduled start times. Scores, team registration, and remote settings are managed on Challengermode.

New here? Start with the [quick start](docs/QUICK_START.md). See [Challengermode setup and migration](docs/CHALLENGERMODE_SETUP.md) to obtain application credentials and connect a tournament.

## Discord permissions

<!-- Please make sure you use an [invite link](https://discord.com/api/oauth2/authorize?client_id=691882968809209917&permissions=275146467392&scope=bot) that automatically grants the following permissions. -->

- Manage Roles: Dot creates a role to designate Tournament Organisers upon joining a server and will create and delete participant roles for each tournament.
- Send Messages
- Manage Messages: Dot automatically removes reactions from "reaction buttons" if participants are dropped via commands.
- Embed Links: Dot sends tournament information in the form of a Discord rich embed.
- Attach Files
- Read Message History

Privileged gateway intents required:

- Server members intent: Dot removes participants from tournaments if they leave the server.

## Usage

After Dot joins your server, you can ping it to confirm that it is working.
You can set permissions for Dot so it is allowed to access only specific channels and locked out of the rest.
If you do not want people to use Dot in a channel, deny Dot access to the channel.
However, if Dot does have access to a channel, make sure it has the full range of permissions listed above.

When Dot joins your server, it will automatically create a `DOT-TO` role to identify tournament hosts.
Give this role to anybody who needs to be able to control Dot to host tournament. Only users with the
role will be allowed to list all tournaments on the server and create new ones. For developers, the name
of the role can be changed by the `DOT_DEFAULT_TO_ROLE` environment variable. In the future, the name
and colour of this role will be configurable per server. For now, please do not delete the role,
rename the role, or create another role with the same name &mdash; Dot will lose track of the role and
recreate it, or worse, identify authorised hosts with the incorrect role.

> **The default role name depends on how you launch Dot.** `.env.example` ships `DOT_DEFAULT_TO_ROLE=TO`
> and the desktop app's setup form defaults to `Organizer`. Whatever you choose, use the same value
> everywhere you configure Dot, and use that exact role name in Discord. See
> [Deployment and operations](docs/OPERATIONS.md#roles-and-permissions).

The default prefix for all Dot commands is `!`. For developers, this can be changed by the `DOT_DEFAULT_PREFIX`
environment variable. In the future, this will also be configurable per server.

Documentation:

- [Quick start](docs/QUICK_START.md) - organiser and participant five-minute paths
- [Commands for tournament hosts](docs/usage-organiser.md)
- [Commands for participants](docs/usage-participant.md)
- [Complete command reference](docs/commands.md) - every command with permission level and parameters, validated against the source in CI
- [Troubleshooting](docs/TROUBLESHOOTING.md) - recovery steps keyed to the bot's actual error messages
- [Challengermode setup and migration](docs/CHALLENGERMODE_SETUP.md)
- [Deployment and operations](docs/OPERATIONS.md) - dashboard access, backups, restore, migrations, security checklist
- [User flows](docs/USER_FLOWS.md) and [flow diagrams](docs/FLOW_DIAGRAMS.md)
- [Testing](docs/TESTING.md) - what the suite covers and what it does not
- [Project improvement guide](docs/IMPROVEMENT_GUIDE.md) - prioritised backlog; see the
  [implementation tracker](docs/improvement-tracker.md) for what has actually landed

## Desktop App

A desktop application is available for easy deployment without requiring Node.js or Docker setup.

### Building the Desktop App

```bash
# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for both
npm run build:all
```

Installers are created in `dist/installers/`.

### Using the Desktop App

1. Run the installer and launch MLBB Tournament Bot
2. Complete the 7-step guided setup wizard (Discord token, Server settings, Challengermode key, optional Email OAuth, Storage, Dashboard access)
3. Click "Save and start bot"
4. Access the web interface via the "🌐 Web Interface" button (authenticated via a one-time local session)

See [docs/DESKTOP_APP_SETUP.md](docs/DESKTOP_APP_SETUP.md) for detailed setup instructions.

## Tests

Run `npm test` for the complete test suite and backend/desktop compilation, `npm run lint` for source checks, and `npm run cover` for coverage. See [testing instructions](docs/TESTING.md) for isolation, scope, and runtime requirements.

## Development

Dot is written in TypeScript. It targets Node.js 24+ and can be run with or without Docker.
It uses Discord.js to talk to Discord and PostgreSQL for persistence.


1. Install Docker with Docker Compose, or install PostgreSQL.
1. Start Postgres. You can start up just the Postgres container with `docker-compose up -d postgres`.
1. Create a `.env` file with the required credentials and configuration. Examples below:
    - In Docker:

        ```
        POSTGRES_HOST_PORT=127.0.0.1:5432
        POSTGRES_USER=
        POSTGRES_PASSWORD=
        POSTGRES_DB=
        DISCORD_TOKEN=
        CHALLENGERMODE_REFRESH_KEY=
        DOT_DEFAULT_PREFIX=!
        DOT_DEFAULT_TO_ROLE=DOT-TO
        ```

    - Outside Docker:

        ```
        NODE_ENV=development
        DEBUG=dot:*
        POSTGRESQL_URL=postgresql://USER:PASSWORD@localhost:5432/DBNAME
        DISCORD_TOKEN=
        CHALLENGERMODE_REFRESH_KEY=
        DOT_DEFAULT_PREFIX=!
        DOT_DEFAULT_TO_ROLE=DOT-TO
        ```

1. Start Dot.
    - In Docker: `docker-compose up --build` and wait for the image to build.
    - Outside Docker: `npm ci && npm run build && node --enable-source-maps dist`.

See [Deployment and operations](docs/OPERATIONS.md) for production configuration, dashboard access, backups, and upgrades.

Please use Australian English spellings.

## Licence

Copyright © 2020&ndash;2025 Luna Brand, Kevin Lu.
See [COPYING](COPYING) for more details.

```
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```
