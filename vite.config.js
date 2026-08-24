import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    /* The provider panel and the raytraced stage are dynamic imports, split
       out so a cold visit does not pay for them. Vite's default would emit
       modulepreload hints that fetch those chunks eagerly anyway, which
       undoes the split — so the hints are off and the chunks load when the
       code actually asks for them. */
    modulePreload: false,
  },
});
