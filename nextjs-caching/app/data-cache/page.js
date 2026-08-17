import { revalidatePath, revalidateTag } from 'next/cache';

export const dynamic = 'force-dynamic';   // isolate the DATA cache from the ROUTE cache

import { url } from '../lib/data.js';

async function variants() {
  // Four fetches of the same endpoint with different caching instructions. Whether the first
  // is cached by default DEPENDS ON YOUR NEXT VERSION — which is the point of measuring.
  const [dflt, noStore, revalidated, tagged] = await Promise.all([
    fetch(url('dc-default', 200)).then((r) => r.json()),
    fetch(url('dc-nostore', 200), { cache: 'no-store' }).then((r) => r.json()),
    fetch(url('dc-revalidate', 200), { next: { revalidate: 10 } }).then((r) => r.json()),
    fetch(url('dc-tagged', 200), { next: { tags: ['products'] } }).then((r) => r.json()),
  ]);
  return { dflt, noStore, revalidated, tagged };
}

export default async function Page() {
  const v = await variants();

  async function purgeTag() {
    'use server';
    revalidateTag('products');
  }
  async function purgePath() {
    'use server';
    revalidatePath('/data-cache');
  }

  const row = (label, data, note) => (
    <tr key={label}>
      <td style={{ padding: '4px 10px' }}><code>{label}</code></td>
      <td style={{ padding: '4px 10px' }}>{data.servedAt}</td>
      <td style={{ padding: '4px 10px', color: '#9a9ab0' }}>{note}</td>
    </tr>
  );

  return (
    <>
      <h1>Data cache</h1>
      <p style={{ color: '#9a9ab0' }}>
        Reload several times. A <code>generatedAt</code> that does not change is a cached fetch;
        one that changes on every reload is not cached.
      </p>
      <table style={{ borderCollapse: 'collapse', fontSize: 13, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        <tbody>
          {row('fetch(url)', v.dflt, 'the DEFAULT — version dependent, so measure it')}
          {row("cache: 'no-store'", v.noStore, 'never cached; changes every reload')}
          {row('next: { revalidate: 10 }', v.revalidated, 'cached for 10s, then refreshed')}
          {row("next: { tags: ['products'] }", v.tagged, 'cached until the tag is revalidated')}
        </tbody>
      </table>
      <form action={purgeTag} style={{ display: 'inline-block', marginTop: 16, marginRight: 8 }}>
        <button type="submit">revalidateTag(&apos;products&apos;)</button>
      </form>
      <form action={purgePath} style={{ display: 'inline-block' }}>
        <button type="submit">revalidatePath(&apos;/data-cache&apos;)</button>
      </form>
    </>
  );
}
