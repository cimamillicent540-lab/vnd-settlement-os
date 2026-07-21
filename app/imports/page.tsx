import type { Metadata } from "next";
import { ImportsClient } from "./imports-client";
export const metadata:Metadata = { title:"数据导入中心" };
export default function ImportsPage(){ return <ImportsClient/>; }
