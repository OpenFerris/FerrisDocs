/**
 * Site footer navigation.
 *
 * Kept out of the component so the link tree can be reviewed and edited as
 * data. Every `href` is a published route with a trailing slash (or an external
 * URL), matching the rest of the documentation.
 */
export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  /** Stable DOM id used to label the column's `<nav>`. */
  id: string;
  title: string;
  links: FooterLink[];
}

export const footerColumns = [
  {
    id: 'ferris-footer-producto',
    title: 'Producto',
    links: [
      { label: 'Primeros pasos', href: '/getting-started/' },
      { label: 'Arquitectura', href: '/arquitectura/' },
      { label: 'Desk y frontend', href: '/frontend/' },
      { label: 'Apps WASM', href: '/apps/' },
    ],
  },
  {
    id: 'ferris-footer-referencia',
    title: 'Referencia',
    links: [
      { label: 'CLI', href: '/cli/' },
      { label: 'API HTTP', href: '/api/' },
      { label: 'DocTypes y campos', href: '/conceptos/' },
      { label: 'Versionado', href: '/referencia/versionado/' },
    ],
  },
  {
    id: 'ferris-footer-proyecto',
    title: 'Proyecto',
    links: [
      { label: 'Contribuir', href: '/contribuir/' },
      { label: 'Pruebas', href: '/contribuir/pruebas/' },
      { label: 'GitHub', href: 'https://github.com/Stdg001/ferris' },
      { label: 'Licencia MIT', href: 'https://github.com/Stdg001/ferris/blob/master/LICENSE' },
    ],
  },
] satisfies FooterColumn[];
