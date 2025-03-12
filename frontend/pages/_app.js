import Head from 'next/head';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <script src="/telegram-web-app.js" async></script>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
