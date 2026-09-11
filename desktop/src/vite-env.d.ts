/// <reference types="vite/client" />

declare module '*.svg?url' {
  const src: string;
  export default src;
}

declare module '*.svg?raw' {
  const src: string;
  export default src;
}

declare module '@lobehub/icons-static-svg/icons/*.svg?url' {
  const src: string;
  export default src;
}

declare module '@lobehub/icons-static-svg/icons/*.svg?raw' {
  const src: string;
  export default src;
}
