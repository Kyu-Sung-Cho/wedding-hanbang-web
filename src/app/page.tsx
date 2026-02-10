import SparkleCanvas from "@/components/landing/SparkleCanvas";
import Navigation from "@/components/landing/Navigation";
import Hero from "@/components/landing/Hero";
import PainPoints from "@/components/landing/PainPoints";
import Solutions from "@/components/landing/Solutions";
import Comparison from "@/components/landing/Comparison";
import VirtualFitting from "@/components/landing/VirtualFitting";
import Stats from "@/components/landing/Stats";
import HowItWorks from "@/components/landing/HowItWorks";
import Testimonials from "@/components/landing/Testimonials";
import CTA from "@/components/landing/CTA";
import Footer from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <SparkleCanvas />
      <Navigation />
      <Hero />
      <PainPoints />
      <Solutions />
      <Comparison />
      <VirtualFitting />
      <Stats />
      <HowItWorks />
      <Testimonials />
      <CTA />
      <Footer />
    </>
  );
}
