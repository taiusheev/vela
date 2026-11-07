/** A `.bin` file wrangler bundles as a Data module (its default rule): the file's bytes. */
declare module "*.bin" {
  const bytes: ArrayBuffer;
  export default bytes;
}
