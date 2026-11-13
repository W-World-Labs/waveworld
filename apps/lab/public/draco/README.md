# Draco model decoders

`npm run dev` and `npm run build` copy the three decoder files from the installed,
lockfile-pinned `three/examples/jsm/libs/draco` directory. Generated copies are
ignored by git and served at the Lab base path plus `/draco/`. The browser uses
these same-origin assets instead of downloading a decoder from a CDN.

The decoders are unmodified [Google Draco](https://github.com/google/draco)
assets distributed under the included [Apache 2.0 license](LICENSE). No new
runtime dependency is installed. To prepare the assets separately:

```bash
node apps/lab/scripts/prepare-model-decoders.mjs
```
