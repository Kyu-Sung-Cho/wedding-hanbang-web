export type VendorCategory = 'studio' | 'dress' | 'makeup' | 'package' | 'snap' | 'dvd' | 'hanbok' | 'suit' | 'jewelry' | 'invitation';
export type VendorImageType = 'portfolio' | 'interior' | 'product';

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  region: string;
  address?: string;
  phone?: string;
  website?: string;
  instagram?: string;
  description?: string;
  style_tags: string[];
  is_fixed_price: boolean;
  is_verified: boolean;
  rating: number | null;
  review_count: number | null;
  thumbnail_url?: string;
  created_at: string;
  updated_at: string;
}

export interface VendorProduct {
  id: string;
  vendor_id: string;
  name: string;
  price: number;
  original_price?: number;
  includes: string[];
  excludes: string[];
  duration?: string;
  notes?: string;
  is_popular: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface VendorImage {
  id: string;
  vendor_id: string;
  image_url: string;
  image_type: VendorImageType;
  sort_order: number;
  created_at: string;
}

export interface VendorWithDetails extends Vendor {
  products?: VendorProduct[];
  images?: VendorImage[];
}

export interface VendorFilter {
  category?: VendorCategory;
  region?: string;
  minPrice?: number;
  maxPrice?: number;
  styleTags?: string[];
  isFixedPrice?: boolean;
}

export const CATEGORY_LABELS: Record<VendorCategory, string> = {
  studio: '스튜디오', dress: '드레스', makeup: '메이크업', package: '패키지',
  snap: '본식스냅', dvd: '본식DVD', hanbok: '한복', suit: '예복',
  jewelry: '예물', invitation: '청첩장',
};

export const REGIONS = [
  '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
  '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
] as const;

export const STYLE_TAGS = [
  '모던', '클래식', '자연광', '빈티지', '럭셔리', '심플', '로맨틱', '미니멀', '화려한', '내추럴',
] as const;
