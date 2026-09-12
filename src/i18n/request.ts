import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // 默认改成中文 zh
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'zh';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // 如果 zh 找不到就回退到英文
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});