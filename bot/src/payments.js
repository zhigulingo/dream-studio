function sendInvoice(bot, ctx, tariff) {
  const prices = {
    basic: 30, // 30 Telegram Stars
    premium: 90, // 90 Telegram Stars
  };
  if (!prices[tariff]) {
    ctx.reply('Неверный тариф');
    return;
  }
  const price = prices[tariff];
  bot.telegram.sendInvoice(ctx.chat.id, {
    title: `Тариф ${tariff}`,
    description: `Покупка тарифа ${tariff}`,
    payload: tariff,
    provider_token: '', // Для Telegram Stars оставьте пустым
    currency: 'XTR',
    prices: [{ label: `Тариф ${tariff}`, amount: price }],
  });
}

module.exports = { sendInvoice };
