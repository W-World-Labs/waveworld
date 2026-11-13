export type { Locale } from './types'
export { DEFAULT_LOCALE, LOCALES, LOCALE_STORAGE_KEY } from './types'
export type { ShellMessageKey } from './messages'
export { shellMessage } from './messages'
export type { NamedEntity } from './display'
export { localizedName, secondaryName, pickLocaleString } from './display'
export { LocaleProvider, useLocale } from './LocaleContext'
export type { PageHeaderCopy } from './pageHeaders'
export { PAGE_HEADERS, pageHeaderForRoute } from './pageHeaders'
export {
  edgeDisplayName,
  edgeEfficiencyNote,
  edgePrinciple,
  prettifyEdgeId,
} from '../edgeDisplay'
export { maturityLabel } from '../maturityDisplay'
export { lossDisplayDesc, lossDisplayName } from '../lossDisplay'
export { quantityNote } from '../quantityDisplay'
export { appDisplayName, deviceDisplayName } from '../deviceDisplay'
export { productModel, productSpec, productVendor } from '../productDisplay'
export { consensusSummary, viewpointStance } from '../consensusDisplay'
export {
  methodFoundation,
  methodSchoolNote,
  methodSchoolStance,
} from '../methodDisplay'
