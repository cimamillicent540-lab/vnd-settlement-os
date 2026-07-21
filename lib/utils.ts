import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Decimal from "decimal.js";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

function groupedDecimal(value:string|number,fractionDigits:number){
  const [integer,fraction]=new Decimal(value).toFixed(fractionDigits).split(".");
  const grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,",");
  return fraction===undefined?grouped:`${grouped}.${fraction}`;
}
export function formatVnd(value: string | number) { return `${groupedDecimal(value,2)} ₫`; }
export function formatUsdt(value: string | number, fractionDigits = 0) { return `${groupedDecimal(value,fractionDigits)} USDT`; }
export function formatRate(value: string | number, fractionDigits = 2) { return groupedDecimal(value,fractionDigits); }
