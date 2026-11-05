export const MAX_IMAGE_QUANTITY = 20;
export const validImageQuantity = (count: unknown): count is number => typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= MAX_IMAGE_QUANTITY;
