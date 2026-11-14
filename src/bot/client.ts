import {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { loadTargets } from '../core/config.js';
import { handleFeedCommand } from './commands/feed.js';

let botClient: Client | null = null;

export function getBotClient(): Client | null {
  return botClient;
}

/**
 * Creates and configures the Discord.js Client instance.
 */
export function createBot(): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Discord Bot logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      // Permission check: Administrator or configured admin role
      const config = loadTargets();
      const member = interaction.member;

      const isAdmin =
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        (config.admin?.adminRoleId &&
          Array.isArray(member?.roles) &&
          member.roles.includes(config.admin.adminRoleId)) ||
        (member?.roles &&
          'cache' in member.roles &&
          config.admin?.adminRoleId &&
          (member.roles as any).cache.has(config.admin.adminRoleId));

      if (!isAdmin) {
        await interaction.reply({
          content: '⛔ Bạn không có quyền thực hiện lệnh này. Yêu cầu quyền Administrator.',
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === 'feed') {
        await handleFeedCommand(interaction as ChatInputCommandInteraction);
      }
    } catch (error) {
      logger.error('Error handling slash interaction:', error);
      if (interaction.isRepliable()) {
        const replyPayload = {
          content: '❌ Đã xảy ra lỗi khi xử lý lệnh.',
          ephemeral: true,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(replyPayload).catch(() => {});
        } else {
          await interaction.reply(replyPayload).catch(() => {});
        }
      }
    }
  });

  botClient = client;
  return client;
}

/**
 * Logs in the Discord Bot using token from environment or targets.json.
 */
export async function startBot(client: Client, token?: string): Promise<void> {
  const finalToken =
    token || process.env.DISCORD_BOT_TOKEN || loadTargets().botToken;

  if (!finalToken || finalToken === 'YOUR_DISCORD_BOT_TOKEN_HERE') {
    logger.warn(
      'No valid Discord bot token provided. Slash commands Gateway will be disabled.',
    );
    return;
  }

  try {
    await client.login(finalToken);
  } catch (error) {
    logger.error('Failed to login Discord bot client:', error);
  }
}
