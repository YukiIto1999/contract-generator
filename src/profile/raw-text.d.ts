/** Source text of a file imported through the bundler `?raw` query */
declare module "*?raw" {
  /** Complete UTF-8 text of the imported file */
  const text: string;
  export default text;
}
