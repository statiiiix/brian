import PillNav from './sections/PillNav';
import VideoFold from './sections/VideoFold';
import IntegrationStrip from './sections/IntegrationStrip';
import BrianLoop from './sections/BrianLoop';
import Pricing from './sections/Pricing';
import FAQ from './sections/FAQ';
import FinalCTA from './sections/FinalCTA';
import Footer from './sections/Footer';
import './HomePage.css';

export default function HomePage() {
  return (
    <div className="home">
      <PillNav />
      <main>
        <VideoFold />
        <IntegrationStrip />
        <BrianLoop />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
