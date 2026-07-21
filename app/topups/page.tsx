import type { Metadata } from "next";
import { TopupsClient } from "./topups-client";
export const metadata:Metadata={title:"补U批次"};
export default function TopupsPage(){return <TopupsClient/>;}
