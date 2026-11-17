import { Slot } from "@radix-ui/react-slot";
import confetti from "https://esm.sh/canvas-confetti@1.6.0";
import { ImageWithFallback } from "./components/ImageWithFallback";

export const parts = [Slot, confetti, ImageWithFallback];
