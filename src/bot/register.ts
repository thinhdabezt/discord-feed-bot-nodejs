import { REST, Routes } from 'discord.js';
import { feedCommandData } from './commands/feed.js';
import { loadTargets } from '../core/config.js';
import { logger } from '../utils/logger.js';

async function registerCommands() {
  const config = loadTargets();
  const token = process.env.DISCORD_BOT_TOKEN || config.botToken;

  if (!token || token === 'YOUR_DISCORD_BOT_TOKEN_HERE') {
    logger.error('Cannot register commands: No botToken provided in config or DISCORD_BOT_TOKEN env var.');
    process.exit(1);
  }

  // Derive Client ID from token if not explicitly provided
  let clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    try {
      const part = token.split('.')[0];
      clientId = Buffer.from(part, 'base64').toString('utf-8');
    } catch {
      // ignore
    }
  }

  if (!clientId || !/^\d+$/.test(clientId)) {
    logger.error('Cannot register commands: Could not determine valid Client ID. Please set DISCORD_CLIENT_ID env var.');
    process.exit(1);
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  const rest = new REST({ version: '10' }).setToken(token);

  const commands = [feedCommandData.toJSON()];

  try {
    logger.info(`Started refreshing ${commands.length} application (/) commands...`);

    if (guildId) {
      // Guild-specific registration (instant update, great for testing)
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      logger.info(`Successfully registered application commands to guild: ${guildId}`);
    } else {
      // Global registration (takes up to a few minutes to propagate across Discord)
      await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      logger.info('Successfully registered application commands globally.');
    }
  } catch (error) {
    logger.error('Failed to register application commands:', error);
    process.exit(1);
  }
}

registerCommands();
