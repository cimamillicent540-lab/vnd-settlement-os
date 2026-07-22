import type {Metadata} from "next";
import {getShadowPricingData} from "@/lib/server-data";
import {ShadowPricingClient} from "./shadow-pricing-client";
export const metadata:Metadata={title:"VND 影子报价"};
export default async function ShadowPricingPage(){return <ShadowPricingClient initial={await getShadowPricingData()}/>;}
