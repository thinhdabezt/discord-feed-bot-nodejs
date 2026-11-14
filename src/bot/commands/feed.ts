import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { config, loadTargets, saveTargets, type Target } from '../../core/config.js';
import { scheduler } from '../../core/scheduler.js';
import { logger } from '../../utils/logger.js';

export const feedCommandData = new SlashCommandBuilder()
  .setName('feed')
  .setDescription('Quản lý danh sách tài khoản theo dõi mạng xã hội (X, IG, FB)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  // Subcommand: add
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add')
      .setDescription('Thêm tài khoản vào danh sách theo dõi')
      .addStringOption((option) =>
        option
          .setName('platform')
          .setDescription('Nền tảng mạng xã hội')
          .setRequired(true)
          .addChoices(
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'ig' },
            { name: 'Facebook', value: 'fb' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('handle')
          .setDescription('Username / Handle cần theo dõi (VD: elonmusk)')
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName('webhook_url')
          .setDescription('URL Webhook nhận bài viết (nếu để trống sẽ dùng webhook mặc định)')
          .setRequired(false),
      ),
  )
  // Subcommand: remove
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Xóa tài khoản khỏi danh sách theo dõi')
      .addStringOption((option) =>
        option
          .setName('platform')
          .setDescription('Nền tảng mạng xã hội')
          .setRequired(true)
          .addChoices(
            { name: 'X (Twitter)', value: 'x' },
            { name: 'Instagram', value: 'ig' },
            { name: 'Facebook', value: 'fb' },
          ),
      )
      .addStringOption((option) =>
        option
          .setName('handle')
          .setDescription('Username / Handle cần xóa')
          .setRequired(true),
      ),
  )
  // Subcommand: list
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('Hiển thị danh sách tất cả các tài khoản đang theo dõi'),
  )
  // Subcommand: status
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription('Xem trạng thái hoạt động của bot và scheduler'),
  );

/**
 * Handle execution of /feed slash commands.
 */
export async function handleFeedCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'add': {
      const platform = interaction.options.getString('platform', true) as 'x' | 'ig' | 'fb';
      let handle = interaction.options.getString('handle', true).trim();
      handle = handle.replace(/^@/, '');
      const webhookUrl = interaction.options.getString('webhook_url');

      const currentConfig = loadTargets();

      // Find if default webhook exists from existing targets or admin
      let finalWebhookUrl = webhookUrl;
      if (!finalWebhookUrl) {
        finalWebhookUrl =
          currentConfig.targets[0]?.webhookUrl || currentConfig.admin?.webhookUrl || '';
      }

      if (!finalWebhookUrl) {
        await interaction.reply({
          content: '❌ Lỗi: Bạn cần cung cấp `webhook_url` do hệ thống chưa có webhook mặc định nào.',
          ephemeral: true,
        });
        return;
      }

      // Check if target already exists
      const existingIdx = currentConfig.targets.findIndex(
        (t) => t.platform === platform && t.handle.toLowerCase() === handle.toLowerCase(),
      );

      const newTarget: Target = {
        platform,
        handle,
        webhookUrl: finalWebhookUrl,
        enabled: true,
      };

      if (existingIdx >= 0) {
        currentConfig.targets[existingIdx] = newTarget;
      } else {
        currentConfig.targets.push(newTarget);
      }

      saveTargets(currentConfig);
      scheduler.addTarget(newTarget);

      const embed = new EmbedBuilder()
        .setColor(0x00ff7f)
        .setTitle('✅ Đã thêm tài khoản theo dõi')
        .setDescription(
          `**Platform:** ${platform.toUpperCase()}\n**Handle:** @${handle}\n**Webhook:** \`${finalWebhookUrl.slice(0, 45)}...\``,
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logger.info(`Command /feed add: added ${platform}/@${handle}`);
      break;
    }

    case 'remove': {
      const platform = interaction.options.getString('platform', true);
      let handle = interaction.options.getString('handle', true).trim();
      handle = handle.replace(/^@/, '');

      const currentConfig = loadTargets();
      const beforeCount = currentConfig.targets.length;

      currentConfig.targets = currentConfig.targets.filter(
        (t) => !(t.platform === platform && t.handle.toLowerCase() === handle.toLowerCase()),
      );

      const removed = currentConfig.targets.length < beforeCount;

      if (!removed) {
        await interaction.reply({
          content: `⚠️ Không tìm thấy tài khoản **${platform.toUpperCase()}**: \`@${handle}\` trong danh sách.`,
          ephemeral: true,
        });
        return;
      }

      saveTargets(currentConfig);
      scheduler.removeTarget(platform, handle);

      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle('🗑️ Đã xóa tài khoản theo dõi')
        .setDescription(`Đã xóa **${platform.toUpperCase()}**: \`@${handle}\` khỏi danh sách.`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      logger.info(`Command /feed remove: removed ${platform}/@${handle}`);
      break;
    }

    case 'list': {
      const currentTargets = scheduler.getTargets();

      if (currentTargets.length === 0) {
        await interaction.reply({
          content: 'ℹ️ Hiện chưa có tài khoản nào trong danh sách theo dõi. Dùng `/feed add` để thêm!',
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x1da1f2)
        .setTitle(`📋 Danh sách tài khoản theo dõi (${currentTargets.length})`)
        .setDescription(
          currentTargets
            .map((t, i) => {
              const statusEmoji = t.enabled ? '🟢' : '🔴';
              return `${i + 1}. ${statusEmoji} **[${t.platform.toUpperCase()}]** \`@${t.handle}\``;
            })
            .join('\n'),
        )
        .setFooter({ text: 'Dùng /feed add hoặc /feed remove để quản lý' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'status': {
      const status = scheduler.getStatus();
      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const seconds = uptimeSec % 60;
      const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

      const memoryUsage = process.memoryUsage();
      const rssMb = (memoryUsage.rss / 1024 / 1024).toFixed(1);
      const heapUsedMb = (memoryUsage.heapUsed / 1024 / 1024).toFixed(1);

      const embed = new EmbedBuilder()
        .setColor(status.running ? 0x00ff7f : 0xff4500)
        .setTitle('📊 Trạng thái Discord Feed Bot')
        .addFields(
          { name: '🔄 Scheduler', value: status.running ? '🟢 Running' : '🔴 Stopped', inline: true },
          { name: '⏱️ Uptime', value: uptimeStr, inline: true },
          { name: '💾 RAM (RSS / Heap)', value: `${rssMb} MB / ${heapUsedMb} MB`, inline: true },
          { name: '🎯 Targets', value: `${status.activeTargets} active / ${status.totalTargets} total`, inline: true },
          {
            name: '🕒 Quét gần nhất',
            value: status.lastPollTime ? status.lastPollTime.toLocaleTimeString() : 'Chưa có',
            inline: true,
          },
          {
            name: '⚠️ Lỗi gần nhất',
            value: status.lastError ? `\`${status.lastError.slice(0, 100)}\`` : 'Không có',
            inline: false,
          },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      break;
    }

    default: {
      await interaction.reply({ content: '❓ Subcommand không xác định.', ephemeral: true });
    }
  }
}
