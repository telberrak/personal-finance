/**
 * Common UK merchants: a clean name and a likely category for bank descriptions such as
 * "AMZN MKTP UK*2X4AB12" or "TFL TRAVEL CH". Shipped with the app, matched on the device.
 * Keys are lower-case words matched at word boundaries; longer keys are tried first.
 */
import { payeeKey } from './payees';

/** A well-known shop or service: patterns that recognise it, its category and its display name. */
export interface Merchant {
  name: string;
  categoryId: string;
  /** Brand colour for the monogram tile. */
  color: string;
}

type Entry = [name: string, categoryId: string, color: string, keys: string[]];

const ENTRIES: Entry[] = [
  // Groceries
  ['Tesco', 'groceries', '#00539f', ['tesco']],
  ['Sainsbury’s', 'groceries', '#f06c00', ['sainsbury', 'sainsburys', 'js online']],
  ['Asda', 'groceries', '#78be20', ['asda']],
  ['Morrisons', 'groceries', '#00563f', ['morrisons', 'wm morrison']],
  ['Aldi', 'groceries', '#00005f', ['aldi']],
  ['Lidl', 'groceries', '#0050aa', ['lidl']],
  ['Waitrose', 'groceries', '#5c8a24', ['waitrose']],
  ['Co-op', 'groceries', '#00a1cc', ['co op', 'coop', 'co operative']],
  ['M&S Food', 'groceries', '#000000', ['m s simply food', 'marks spencer food', 'm s food']],
  ['Iceland', 'groceries', '#d2212d', ['iceland foods', 'iceland']],
  ['Ocado', 'groceries', '#4a2a7c', ['ocado']],
  ['Farmfoods', 'groceries', '#e30613', ['farmfoods']],
  ['Spar', 'groceries', '#e2001a', ['spar']],
  ['Budgens', 'groceries', '#e4002b', ['budgens']],
  ['Costco', 'groceries', '#005daa', ['costco']],
  // Eating out
  ['Pret A Manger', 'eating', '#8a1538', ['pret a manger', 'pret']],
  ['Costa Coffee', 'eating', '#6d1f37', ['costa coffee', 'costa']],
  ['Starbucks', 'eating', '#00704a', ['starbucks']],
  ['Caffè Nero', 'eating', '#1d1d1b', ['caffe nero', 'nero']],
  ['Greggs', 'eating', '#00558f', ['greggs']],
  ['McDonald’s', 'eating', '#da291c', ['mcdonalds', 'mcdonald s']],
  ['KFC', 'eating', '#a3080c', ['kfc']],
  ['Burger King', 'eating', '#d62300', ['burger king']],
  ['Nando’s', 'eating', '#c8102e', ['nandos', 'nando s']],
  ['Wagamama', 'eating', '#e2231a', ['wagamama']],
  ['Pizza Express', 'eating', '#1a1a1a', ['pizza express', 'pizzaexpress']],
  ['Domino’s', 'eating', '#006491', ['dominos', 'domino s']],
  ['Pizza Hut', 'eating', '#ee3124', ['pizza hut']],
  ['Subway', 'eating', '#008c15', ['subway']],
  ['Leon', 'eating', '#1f3a5f', ['leon restaurants']],
  ['Itsu', 'eating', '#e4007c', ['itsu']],
  ['Wasabi', 'eating', '#d7001e', ['wasabi']],
  ['Five Guys', 'eating', '#c8102e', ['five guys']],
  ['Deliveroo', 'eating', '#00ccbc', ['deliveroo']],
  ['Just Eat', 'eating', '#ff8000', ['just eat', 'justeat']],
  ['Uber Eats', 'eating', '#06c167', ['uber eats', 'ubereats']],
  ['Wetherspoon', 'eating', '#1c3f94', ['wetherspoon', 'jd wetherspoon']],
  ['Gail’s', 'eating', '#2b2b2b', ['gails', 'gail s']],
  ['Tim Hortons', 'eating', '#c8102e', ['tim hortons']],
  // Transport
  ['TfL', 'transport', '#0019a8', ['tfl', 'transport for london', 'tfl travel']],
  ['Uber', 'transport', '#000000', ['uber trip', 'uber bv', 'uber']],
  ['Bolt', 'transport', '#34d186', ['bolt eu', 'bolt']],
  ['Trainline', 'transport', '#01c3a7', ['trainline']],
  ['LNER', 'transport', '#ce0e2d', ['lner']],
  ['Avanti West Coast', 'transport', '#004354', ['avanti west coast', 'avanti']],
  ['GWR', 'transport', '#0a493e', ['gwr', 'great western rail']],
  ['Southern', 'transport', '#8cc63e', ['southern rail', 'southern railway']],
  ['Northern', 'transport', '#262262', ['northern trains', 'northern rail']],
  ['National Express', 'transport', '#e2001a', ['national express']],
  ['Stagecoach', 'transport', '#00539f', ['stagecoach']],
  ['Shell', 'transport', '#dd1d21', ['shell']],
  ['BP', 'transport', '#009900', ['bp']],
  ['Esso', 'transport', '#ee1c25', ['esso']],
  ['Texaco', 'transport', '#e2231a', ['texaco']],
  ['RingGo', 'transport', '#00a2e1', ['ringgo']],
  ['PayByPhone', 'transport', '#0072ce', ['paybyphone']],
  ['easyJet', 'transport', '#ff6600', ['easyjet']],
  ['Ryanair', 'transport', '#073590', ['ryanair']],
  ['British Airways', 'transport', '#075aaa', ['british airways', 'british a']],
  ['Lime', 'transport', '#00de00', ['lime ride', 'lime']],
  ['Santander Cycles', 'transport', '#ec0000', ['santander cycles']],
  // Shopping
  ['Amazon', 'shopping', '#ff9900', ['amazon', 'amzn mktp', 'amzn', 'amazon co uk']],
  ['eBay', 'shopping', '#e53238', ['ebay']],
  ['Argos', 'shopping', '#d42114', ['argos']],
  ['John Lewis', 'shopping', '#000000', ['john lewis']],
  ['Marks & Spencer', 'shopping', '#000000', ['marks spencer', 'm s']],
  ['Next', 'shopping', '#000000', ['next retail', 'next plc', 'next directory']],
  ['Primark', 'shopping', '#0dace1', ['primark']],
  ['H&M', 'shopping', '#e50010', ['h m', 'hm']],
  ['Zara', 'shopping', '#000000', ['zara']],
  ['Uniqlo', 'shopping', '#ff0000', ['uniqlo']],
  ['ASOS', 'shopping', '#2d2d2d', ['asos']],
  ['Boots', 'shopping', '#05054b', ['boots']],
  ['Superdrug', 'shopping', '#e3007b', ['superdrug']],
  ['IKEA', 'shopping', '#0058a3', ['ikea']],
  ['B&Q', 'shopping', '#f68b1f', ['b q', 'bandq']],
  ['Screwfix', 'shopping', '#0072bc', ['screwfix']],
  ['Wickes', 'shopping', '#0068a5', ['wickes']],
  ['Currys', 'shopping', '#5b2c86', ['currys']],
  ['Apple', 'shopping', '#000000', ['apple store', 'apple com uk']],
  ['TK Maxx', 'shopping', '#e2001a', ['tk maxx', 'tkmaxx']],
  ['Sports Direct', 'shopping', '#002f87', ['sports direct', 'sportsdirect']],
  ['JD Sports', 'shopping', '#000000', ['jd sports']],
  ['WHSmith', 'shopping', '#004b87', ['whsmith', 'wh smith']],
  ['Waterstones', 'shopping', '#000000', ['waterstones']],
  ['Wilko', 'shopping', '#e2001a', ['wilko']],
  ['The Range', 'shopping', '#004b87', ['the range']],
  ['Dunelm', 'shopping', '#000000', ['dunelm']],
  ['Etsy', 'shopping', '#f1641e', ['etsy']],
  ['Vinted', 'shopping', '#09b1ba', ['vinted']],
  ['Shein', 'shopping', '#000000', ['shein']],
  ['Temu', 'shopping', '#fb7701', ['temu']],
  ['Pets at Home', 'shopping', '#00965e', ['pets at home']],
  // Fun and subscriptions
  ['Netflix', 'bills', '#e50914', ['netflix']],
  ['Spotify', 'bills', '#1db954', ['spotify']],
  ['Disney+', 'bills', '#113ccf', ['disney plus', 'disneyplus', 'disney']],
  ['Amazon Prime', 'bills', '#00a8e1', ['amazon prime', 'prime video', 'amzn prime']],
  ['Apple Services', 'bills', '#000000', ['apple com bill', 'itunes']],
  ['YouTube Premium', 'bills', '#ff0000', ['youtube premium', 'google youtube']],
  ['NOW', 'bills', '#00818a', ['now tv', 'nowtv']],
  ['Audible', 'bills', '#f8991c', ['audible']],
  ['PlayStation', 'fun', '#003791', ['playstation', 'sony interactive']],
  ['Xbox', 'fun', '#107c10', ['xbox', 'microsoft xbox']],
  ['Steam', 'fun', '#171a21', ['steam games', 'steampowered', 'steam']],
  ['Nintendo', 'fun', '#e60012', ['nintendo']],
  ['Odeon', 'fun', '#00205b', ['odeon']],
  ['Cineworld', 'fun', '#e2001a', ['cineworld']],
  ['Vue', 'fun', '#ef3e42', ['vue cinema', 'vue']],
  ['Ticketmaster', 'fun', '#026cdf', ['ticketmaster']],
  ['PureGym', 'bills', '#00a5a8', ['puregym', 'pure gym']],
  ['The Gym Group', 'bills', '#00a7e1', ['the gym group', 'gym group']],
  ['David Lloyd', 'bills', '#00205b', ['david lloyd']],
  // Bills and utilities
  ['Octopus Energy', 'bills', '#1d0b3a', ['octopus energy', 'octopus']],
  ['British Gas', 'bills', '#00a1de', ['british gas']],
  ['EDF', 'bills', '#fe5716', ['edf energy', 'edf']],
  ['E.ON Next', 'bills', '#ea1c0a', ['eon next', 'e on', 'eon']],
  ['OVO', 'bills', '#0a9828', ['ovo energy', 'ovo']],
  ['Thames Water', 'bills', '#005eb8', ['thames water']],
  ['Severn Trent', 'bills', '#00539f', ['severn trent']],
  ['Council Tax', 'bills', '#5a5a5a', ['council tax', 'council']],
  ['TV Licence', 'bills', '#000000', ['tv licence', 'tv licensing']],
  ['BT', 'bills', '#5514b4', ['bt group', 'bt']],
  ['Sky', 'bills', '#0072c9', ['sky digital', 'sky uk', 'sky']],
  ['Virgin Media', 'bills', '#e10a0a', ['virgin media']],
  ['Vodafone', 'bills', '#e60000', ['vodafone']],
  ['EE', 'bills', '#007b85', ['ee limited', 'ee']],
  ['O2', 'bills', '#0019a5', ['o2', 'telefonica']],
  ['Three', 'bills', '#000000', ['three uk', 'hutchison 3g']],
  ['giffgaff', 'bills', '#000000', ['giffgaff']],
  ['Aviva', 'bills', '#ffd900', ['aviva']],
  ['Admiral', 'bills', '#0b1e43', ['admiral']],
  ['Direct Line', 'bills', '#e2001a', ['direct line']],
];

const INDEX = ENTRIES.flatMap(([name, categoryId, color, keys]) =>
  keys.map((key) => ({ key, merchant: { name, categoryId, color } })),
).sort((a, b) => b.key.length - a.key.length);

/** The merchant a bank description or payee most likely refers to. */
export function findMerchant(payee: string): Merchant | undefined {
  const text = ` ${payeeKey(payee)} `;
  return INDEX.find(({ key }) => text.includes(` ${key} `))?.merchant;
}

/** How many merchants are known (checked by the tests). */
export const MERCHANT_COUNT = ENTRIES.length;
