/** Decimal rounding that avoids binary-float surprises such as 1.005 -> 1.00. */
export function roundDecimal(value: number, digits: number): number {
    if (!Number.isFinite(value)) return 0;
    const sign = Math.sign(value) || 1;
    const shifted = Number(`${Math.abs(value)}e${digits}`);
    return sign * Number(`${Math.round(shifted)}e-${digits}`);
}

export const roundMoney = (value: number): number => roundDecimal(value, 2);
export const roundVatRate = (value: number): number => roundDecimal(value, 2);
