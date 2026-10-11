export type Category = 'electronics' | 'gift-cards';

export interface Item {
  name: string;
  category: Category;
  price: number;
}

export function subtotalOf(items: Item[]): number {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal;
}
