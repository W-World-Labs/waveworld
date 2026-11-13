import { PRODUCT_SPEC_EN } from '../data/ontology/product.specEn'
import { PRODUCT_VENDOR_EN } from '../data/ontology/product.vendorEn'
import { PRODUCT_MODEL_EN } from '../data/ontology/product.modelEn'
import type { Product } from '../data/ontology/types'
import type { Locale } from './i18n/types'

const CJK = /[\u4e00-\u9fff]/

/**
 * Locale-aware product.spec. Chinese source untouched.
 * EN: prefer specEn / PRODUCT_SPEC_EN overlay; hide remaining CJK-only specs.
 */
export function productSpec(
  product: Pick<Product, 'spec' | 'specEn'>,
  locale: Locale = 'zh',
): string | undefined {
  if (!product.spec) return undefined
  if (locale !== 'en') return product.spec
  const en =
    product.specEn?.trim() || PRODUCT_SPEC_EN[product.spec]?.trim() || undefined
  if (en) return en
  // Progressive: skip Chinese-only specs until overlay exists
  if (CJK.test(product.spec)) return undefined
  return product.spec
}

/**
 * Locale-aware product.vendor. Chinese source untouched.
 * EN: prefer vendorEn / PRODUCT_VENDOR_EN; fall back to Chinese if unmapped.
 */
export function productVendor(
  product: Pick<Product, 'vendor' | 'vendorEn'>,
  locale: Locale = 'zh',
): string | undefined {
  if (!product.vendor) return undefined
  if (locale !== 'en') return product.vendor
  return (
    product.vendorEn?.trim() ||
    PRODUCT_VENDOR_EN[product.vendor]?.trim() ||
    product.vendor
  )
}

/**
 * Locale-aware product.model. Chinese source untouched.
 * EN: prefer modelEn / PRODUCT_MODEL_EN; fall back to Chinese if unmapped.
 */
export function productModel(
  product: Pick<Product, 'model' | 'modelEn'>,
  locale: Locale = 'zh',
): string {
  if (locale !== 'en') return product.model
  return (
    product.modelEn?.trim() ||
    PRODUCT_MODEL_EN[product.model]?.trim() ||
    product.model
  )
}
