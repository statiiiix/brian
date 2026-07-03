import Nav from './sections/Nav';
import TopFold from './sections/TopFold';
import IntegrationStrip from './sections/IntegrationStrip';
import Problem from './sections/Problem';
import HowItWorks from './sections/HowItWorks';
import Refusal from './sections/Refusal';
import StatStrip from './sections/StatStrip';
import UnderTheHood from './sections/UnderTheHood';
import Features from './sections/Features';
import Manifesto from './sections/Manifesto';
import Pricing from './sections/Pricing';
import FAQ from './sections/FAQ';
import FinalCTA from './sections/FinalCTA';
import Footer from './sections/Footer';
import './HomePage.css';

export default function HomePage() {
  return (
    <div className="home">
      <Nav />
      <main>
        <TopFold />
        <IntegrationStrip />
        <Problem />
        <HowItWorks />
        <Refusal />
        <StatStrip />
        <UnderTheHood />
        <Features />
        <Manifesto />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
