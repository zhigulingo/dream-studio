function validateDream(text) {
  return (
    text.length >= 40 &&
    /[а-яА-Я]/.test(text) &&
    !/^\d+$/.test(text) &&
    !/^[\p{Emoji}]+$/u.test(text)
  );
}

async function checkSubscription(bot, userId) {
  try {
    const chatMember = await bot.telegram.getChatMember('@TheDreamsHub', userId);
    return ['member', 'administrator', 'creator'].includes(chatMember.status);
  } catch (error) {
    return false;
  }
}

module.exports = { validateDream, checkSubscription };
