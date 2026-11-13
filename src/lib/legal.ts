import { Alert, Linking, Platform, Share } from 'react-native';

// Public pages published from site/ by .github/workflows/pages.yml.
const SITE = 'https://mopsha.github.io/WTW-CSE416';

export const PRIVACY_URL = `${SITE}/privacy.html`;
export const TERMS_URL = `${SITE}/terms.html`;
export const SUPPORT_URL = `${SITE}/support.html`;

/** Opens a public page; if the browser can't open, offers a retry or sharing the link. */
export async function openLegalPage(url: string, title: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      `Couldn't open ${title}`,
      `Try again, or share the link to open it elsewhere.\n\n${url}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share link',
          onPress: () =>
            void Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch(() => {}),
        },
        { text: 'Try again', onPress: () => void openLegalPage(url, title) },
      ],
    );
  }
}
