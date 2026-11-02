/** Pictures bundled with the app: Metro gives a number that `<Image source>` takes. */
declare module "*.jpg" {
  const asset: number;
  export default asset;
}

/** A bundled font file resolves to an asset id, as an image does. */
declare module "*.ttf" {
  const asset: number;
  export default asset;
}
