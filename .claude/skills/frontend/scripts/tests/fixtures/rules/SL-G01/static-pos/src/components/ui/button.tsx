import { Slot } from "@radix-ui/react-slot@1.1.2";
import { cva } from "class-variance-authority@0.7.1";

export const buttonVariants = cva("inline-flex items-center");
export const Root = Slot;
