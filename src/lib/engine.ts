// --- Configuration ---

class GlickoConfig {
	/** The initial rating assigned to a new player. */
	readonly initialRating: number;
	/** The initial rating deviation assigned to a new player. */
	readonly initialRatingDeviation: number;
	/** The minimum rating deviation assigned to a player once their rating has stabilised. */
	readonly minRatingDeviation: number;

	/** The initial volatility assigned to a new player. */
	readonly initialVolatility: number;
	/** The volatility of the volatility (`τ` from Glicko-2). */
	readonly volatilityVolatility: number;
	/** The period (in milliseconds) over which a player's rating deviation decays by the decay rate. */
	readonly decayPeriodMs: number;

	/** The standard deviation of the rating distribution, used to calculate the expected score. */
	readonly standardDeviation: number;
	/** `q` from Glicko. Acts as a scale factor from the Glicko-1 scale to the Glicko-2 scale. */
	readonly scaleFactor: number;
	/** Scale factor for converting from the Glicko-2 scale to the Glicko-1 scale. */
	readonly inverseScaleFactor: number;

	constructor(options: {
		initialRating: number;
		initialRatingDeviation: number;
		minRatingDeviation: number;
		initialVolatility: number;
		volatilityVolatility: number;
		standardDeviation: number;
		decayPeriodMs: number;
	}) {
		this.initialRating = options.initialRating;
		this.initialRatingDeviation = options.initialRatingDeviation;
		this.minRatingDeviation = options.minRatingDeviation;
		this.initialVolatility = options.initialVolatility;
		this.volatilityVolatility = options.volatilityVolatility;
		this.decayPeriodMs = options.decayPeriodMs;

		this.standardDeviation = options.standardDeviation;
		this.scaleFactor = Math.LN10 / this.standardDeviation;
		this.inverseScaleFactor = this.standardDeviation / Math.LN10;
	}

	/** `g(ϕ)` from Glicko-2. */
	calculateDeviationImpactFactor(scaledRatingDeviation: number): number {
		return 1 / Math.sqrt(1 + (3 * scaledRatingDeviation ** 2) / Math.PI ** 2);
	}

	/** `E(μ, μ_j, ϕ_j)` from Glicko-2. */
	calculateExpectedScore(
		scaledRating: number,
		opponentScaledRating: number,
		opponentScaledDeviation: number,
	): number {
		const impactFactor = this.calculateDeviationImpactFactor(
			opponentScaledDeviation,
		);
		return (
			1 / (1 + Math.exp(-impactFactor * (scaledRating - opponentScaledRating)))
		);
	}

	createRating(): GlickoRating {
		return new GlickoRating(this);
	}
}

const HUMAN_ACCURACY_GLICKO_CONFIG = new GlickoConfig({
	initialRating: 1000,
	initialRatingDeviation: 350,
	minRatingDeviation: 30,
	initialVolatility: 0.06,
	volatilityVolatility: 0.5,
	standardDeviation: 400,
	decayPeriodMs: 24 * 60 * 60 * 1000, // 1 day
});

const QUESTION_ACCURACY_GLICKO_CONFIG = new GlickoConfig({
	initialRating: 1000,
	initialRatingDeviation: 350,
	minRatingDeviation: 30,
	initialVolatility: 0.06,
	volatilityVolatility: 0.1,
	standardDeviation: 400,
	decayPeriodMs: 24 * 60 * 60 * 1000, // 1 day
});

const HUMAN_SPEED_GLICKO_CONFIG = new GlickoConfig({
	initialRating: 1000,
	initialRatingDeviation: 350,
	minRatingDeviation: 30,
	initialVolatility: 0.06,
	volatilityVolatility: 0.5,
	standardDeviation: 400,
	decayPeriodMs: 24 * 60 * 60 * 1000, // 1 day
});

const QUESTION_SPEED_GLICKO_CONFIG = new GlickoConfig({
	initialRating: 1000,
	initialRatingDeviation: 350,
	minRatingDeviation: 30,
	initialVolatility: 0.06,
	volatilityVolatility: 0.1,
	standardDeviation: 400,
	decayPeriodMs: 24 * 60 * 60 * 1000, // 1 day
});

/** The weight of the accuracy rating in the composite rating. `COMPOSITE_ACCURACY_WEIGHT + COMPOSITE_SPEED_WEIGHT` must equal 1. */
const COMPOSITE_ACCURACY_WEIGHT = 0.8;
/** The weight of the speed rating in the composite rating. `COMPOSITE_ACCURACY_WEIGHT + COMPOSITE_SPEED_WEIGHT` must equal 1. */
const COMPOSITE_SPEED_WEIGHT = 1 - COMPOSITE_ACCURACY_WEIGHT;

/** After how many answers to a question with a continuous answer the question's statistics are considered reliable enough to ignore anomalous answers when calculating the question's statistics. */
const MIN_ATTEMPTS_FOR_ANOMALY_DETECTION = 20;

/** How many standard deviations away from the mean a result must be to be considered anomalous and ignored when calculating the question's statistics. */
const OUTLIER_Z_SCORE_THRESHOLD = 3; // 99.7% of answers should be within 3 standard deviations of the mean

/** The minimum standard deviation of a question's speed, to prevent division by zero and to prevent a question from being considered infinitely fast. */
const MIN_SPEED_STANDARD_DEVIATION_MS = 10;

/** The minimum weight a part of a question can have towards a score, relative to the number of parts the question is scored on. */
const MIN_QUESTION_PART_WEIGHT = 0.05;

/** How much the accuracy of an answer affects the speed score. 0 means not at all, 1 means the speed score's deviation from 0.5 is multiplied by the accuracy (e.g. a completely inaccurate answer would result in a neutral speed score of 0.5 even if the answer was very fast). */
const ACCURACY_WEIGHT_FOR_SPEED_RATING = 1;

/** The minimum accuracy a human must achieve on a question for their speed to be considered in the question's speed statistics. */
const ACCURACY_THRESHOLD_FOR_SPEED_TUNING = 0.5;

// --- State ---

class GlickoRating {
	readonly config: GlickoConfig;
	rating: number;
	deviation: number;
	volatility: number;
	lastRankedAt: Date | null = null;

	constructor(
		config: GlickoConfig,
		rating = config.initialRating,
		deviation = config.initialRatingDeviation,
		volatility = config.initialVolatility,
	) {
		this.config = config;
		this.rating = rating;
		this.deviation = deviation;
		this.volatility = volatility;
	}

	get internalRating(): number {
		return (this.rating - this.config.initialRating) * this.config.scaleFactor;
	}

	get internalDeviation(): number {
		return this.deviation * this.config.scaleFactor;
	}

	/** Increases the rating deviation based on the elapsed time and the volatility. */
	decay(date: Date): void {
		if (this.lastRankedAt) {
			const periodsElapsed = Math.max(
				0,
				(date.getTime() - this.lastRankedAt.getTime()) /
					this.config.decayPeriodMs,
			);

			this.deviation = Math.min(
				this.config.initialRatingDeviation,
				Math.sqrt(
					this.internalDeviation ** 2 + periodsElapsed * this.volatility ** 2,
				) / this.config.scaleFactor,
			);
		}
		this.lastRankedAt = date;
	}

	/** Vibe-coded online Glicko-2 implementation. */
	update(opponentRating: GlickoRating, score: number): void {
		const config = this.config;

		// 1. Convert to Glicko-2 scale
		const mu = this.internalRating;
		const phi = this.internalDeviation;
		const sigma = this.volatility;

		const mu_j = opponentRating.internalRating;
		const phi_j = opponentRating.internalDeviation;

		// 2. Compute the impact factor and expected score.
		// We inline the calculation here to avoid computing g(phi_j) twice
		// (once here and once in config.calculateExpectedScore).
		const g_j = config.calculateDeviationImpactFactor(phi_j);

		// Clamp the exponential argument to prevent Math.exp from underflowing to 0 or overflowing to Infinity.
		// This avoids NaNs and division-by-zeros downstream (e.g. infinite variance).
		let expArg = -g_j * (mu - mu_j);
		if (expArg > 50) expArg = 50;
		else if (expArg < -50) expArg = -50;

		const ex = Math.exp(expArg);
		const E = 1 / (1 + ex);

		// E * (1 - E) simplifies to ex / (1 + ex)^2, which naturally preserves precision better.
		const E_variance = ex / ((1 + ex) * (1 + ex));

		// 3. Compute estimated variance
		const v = 1 / (g_j * g_j * E_variance);

		// 4. Compute estimated improvement
		const delta = v * g_j * (score - E);

		// 5. Update volatility using the Illinois algorithm
		const tau = config.volatilityVolatility;
		const tau2 = tau * tau;
		const phi2 = phi * phi;
		const delta2 = delta * delta;
		const a = Math.log(sigma * sigma);

		const f = (x: number) => {
			const exp_x = Math.exp(x);
			const num = exp_x * (delta2 - phi2 - v - exp_x);
			const den = 2 * (phi2 + v + exp_x) * (phi2 + v + exp_x);
			return num / den - (x - a) / tau2;
		};

		let A = a;
		let B = 0;

		if (delta2 > phi2 + v) {
			B = Math.log(delta2 - phi2 - v);
		} else {
			let k = 1;
			while (f(a - k * tau) < 0) {
				k++;
			}
			B = a - k * tau;
		}

		let fA = f(A);
		let fB = f(B);
		const epsilon = 0.000001;

		while (Math.abs(B - A) > epsilon) {
			const C = A + ((A - B) * fA) / (fB - fA);
			const fC = f(C);
			if (fC * fB <= 0) {
				A = B;
				fA = fB;
			} else {
				fA /= 2;
			}
			B = C;
			fB = fC;
		}

		const newSigma = Math.exp(A / 2);

		// 6. Update rating deviation
		const phiStar2 = phi2 + newSigma * newSigma;
		const newPhi = 1 / Math.sqrt(1 / phiStar2 + 1 / v);

		// 7. Update rating
		const newMu = mu + newPhi * newPhi * g_j * (score - E);

		// 8. Convert back to original scale
		this.rating = config.initialRating + newMu * config.inverseScaleFactor;
		this.deviation = Math.max(
			config.minRatingDeviation,
			newPhi * config.inverseScaleFactor,
		);
		this.volatility = newSigma;
	}

	copy(): GlickoRating {
		return new GlickoRating(
			this.config,
			this.rating,
			this.deviation,
			this.volatility,
		);
	}
}

/** Welford's online algorithm for computing the mean and variance of a stream of numbers. */
class RunningStat {
	readonly minStandardDeviation: number;

	constructor(minStandardDeviation: number) {
		this.minStandardDeviation = minStandardDeviation;
	}

	#n = 0;
	#mean = 0;
	#m2 = 0;

	push(value: number): void {
		let delta = value - this.#mean;

		// Clamp anomalous answers
		if (this.#n >= MIN_ATTEMPTS_FOR_ANOMALY_DETECTION) {
			const anomalousThreshold =
				OUTLIER_Z_SCORE_THRESHOLD * this.standardDeviation;
			if (Math.abs(delta) > anomalousThreshold) {
				delta = Math.sign(delta) * anomalousThreshold;
				value = this.#mean + delta;
			}
		}

		this.#n++;
		this.#mean += delta / this.#n;
		const delta2 = value - this.#mean;
		this.#m2 += delta * delta2;
	}

	get count(): number {
		return this.#n;
	}

	get mean(): number {
		return this.#mean;
	}

	get variance(): number {
		return this.#n > 1 ? this.#m2 / (this.#n - 1) : 0;
	}

	get standardDeviation(): number {
		return Math.max(this.minStandardDeviation, Math.sqrt(this.variance));
	}
}

/** A human or question; a player in the Glicko rating system. */
abstract class Entity {
	readonly accuracyRating: GlickoRating;
	readonly speedRating: GlickoRating;
	gamesPlayed = 0;

	constructor(accuracyRating: GlickoRating, speedRating: GlickoRating) {
		this.accuracyRating = accuracyRating;
		this.speedRating = speedRating;
	}

	/** The composite rating of the player, calculated as a weighted average of the accuracy and speed ratings. */
	get compositeRating(): number {
		return (
			this.accuracyRating.rating * COMPOSITE_ACCURACY_WEIGHT +
			this.speedRating.rating * COMPOSITE_SPEED_WEIGHT
		);
	}
}

class Human extends Entity {
	constructor() {
		super(
			HUMAN_ACCURACY_GLICKO_CONFIG.createRating(),
			HUMAN_SPEED_GLICKO_CONFIG.createRating(),
		);
	}

	get proficiencyRating(): GlickoRating {
		return this.accuracyRating;
	}

	get fluencyRating(): GlickoRating {
		return this.speedRating;
	}

	/** @deprecated use proficiencyRating for humans */
	declare accuracyRating: GlickoRating;

	/** @deprecated use fluencyRating for humans */
	declare speedRating: GlickoRating;
}

type QuestionPartId = string;

abstract class Question<Answer> extends Entity {
	/** Map from the ID of a discrete part of the question to the assumed probability of guessing the part by random chance (usually `1 / number of possible answers for the part`). */
	private readonly discretePartGuessChances: Record<QuestionPartId, number>;
	/** Map from the ID of a continuous part of the question to the minimum standard deviation of the part's statistics. */
	private readonly continuousMinStandardDeviation: Record<
		QuestionPartId,
		number
	>;

	/** Map from the ID of a discrete part of the question to the number of times humans have answered the part correctly. */
	private readonly discretePartCounts: Record<
		QuestionPartId,
		{ attempts: number; successes: number }
	> = {};
	/** Map from the ID of a continuous part of the question to the running statistic for the difference between humans' answers and the correct answer for that part. */
	private readonly continuousErrorStats: Record<QuestionPartId, RunningStat> =
		{};
	/** Running statistic for the speed humans answer this question. */
	private readonly speedStats = new RunningStat(
		MIN_SPEED_STANDARD_DEVIATION_MS,
	);

	constructor(
		discretePartGuessChances: Record<QuestionPartId, number | undefined> = {},
		continuousMinStandardDeviation: Record<
			QuestionPartId,
			number | undefined
		> = {},
	) {
		super(
			QUESTION_ACCURACY_GLICKO_CONFIG.createRating(),
			QUESTION_SPEED_GLICKO_CONFIG.createRating(),
		);

		function filterUndefinedValues<T>(
			obj: Record<string, T | undefined>,
		): Record<string, T> {
			const filtered: Record<string, T> = {};
			for (const [key, value] of Object.entries(obj)) {
				if (value !== undefined) {
					filtered[key] = value;
				}
			}
			return filtered;
		}

		this.discretePartGuessChances = filterUndefinedValues(
			discretePartGuessChances,
		);
		this.continuousMinStandardDeviation = filterUndefinedValues(
			continuousMinStandardDeviation,
		);
	}

	get difficultyRating(): GlickoRating {
		return this.accuracyRating;
	}

	get timeDemandRating(): GlickoRating {
		return this.speedRating;
	}

	/** @deprecated use difficultyRating for questions */
	declare accuracyRating: GlickoRating;

	/** @deprecated use timeDemandRating for questions */
	declare speedRating: GlickoRating;

	calculateDiscretePartWeight(partId: QuestionPartId): number {
		if (this.gamesPlayed === 0) return 1;
		const counts = this.discretePartCounts[partId];
		if (!counts?.attempts) return 1;
		const successRate = counts.successes / counts.attempts;
		return Math.max(1 - successRate, MIN_QUESTION_PART_WEIGHT);
	}

	/** Updates the question's difficulty statistics based on a human's answer to the question. */
	tuneDifficultyModel(
		correctParts: Record<QuestionPartId, boolean>,
		partErrors: Record<QuestionPartId, number>,
	): void {
		for (const [partId, correct] of Object.entries(correctParts)) {
			this.discretePartCounts[partId] ??= { attempts: 0, successes: 0 };
			const part = this.discretePartCounts[partId];
			part.attempts++;
			if (correct) {
				part.successes++;
			}
		}
		for (const [partId, error] of Object.entries(partErrors)) {
			if (!this.continuousErrorStats[partId]) {
				this.continuousErrorStats[partId] = new RunningStat(
					this.continuousMinStandardDeviation[partId] ?? 1,
				);
			}
			this.continuousErrorStats[partId].push(Math.abs(error));
		}
	}

	/** Updates the question's speed statistics based on a human's answer time to the question. */
	tuneSpeedModel(answerTimeMs: number): void {
		this.speedStats.push(answerTimeMs);
	}

	/** Calculates a rating for a human's answer to this question between 0 and 1, where 0 is completely wrong, 0.5 is average, and 1 is completely correct. */
	calculateAccuracyFromParts(
		correctParts: Record<QuestionPartId, boolean> = {},
		partErrors: Record<QuestionPartId, number> = {},
	): number {
		// Calculate discrete score
		let discreteScore = 0;
		let discreteMaxScore = 0;
		let discreteGuessableScore = 0;
		for (const [partId, correct] of Object.entries(correctParts)) {
			const weight = this.calculateDiscretePartWeight(partId);
			discreteMaxScore += weight;
			if (correct) {
				discreteScore += weight;
			}
			discreteGuessableScore +=
				weight * (this.discretePartGuessChances[partId] ?? 0);
		}
		const adjustedDiscreteScore =
			discreteGuessableScore === discreteMaxScore
				? 0
				: Math.max(
						0,
						((discreteScore - discreteGuessableScore) /
							(discreteMaxScore - discreteGuessableScore)) *
							discreteMaxScore,
					);

		// Calculate continuous score
		let continuousScore = 0;
		const continuousMaxScore = Object.keys(partErrors).length;
		for (const [partId, error] of Object.entries(partErrors)) {
			const stats = this.continuousErrorStats[partId];
			if (!stats) {
				continuousScore += error === 0 ? 1 : 0;
				continue;
			}

			if (stats.mean > 0) {
				continuousScore += Math.exp(-Math.abs(error) / stats.mean);
			} else if (error === 0) {
				continuousScore += 1;
			}
		}

		// Combine discrete and continuous scores
		const totalScore = adjustedDiscreteScore + continuousScore;
		const totalMax = discreteMaxScore + continuousMaxScore;
		if (totalMax === 0) return 0;
		return totalScore / totalMax;
	}

	/** Returns whether the question has any speed statistics, which is required to calculate a speed score. */
	hasSpeedStats(): boolean {
		return this.speedStats.count > 0;
	}

	/** Calculates a rating for a human's speed in answering this question between 0 and 1, where 0 is infinitely slow, 0.5 is average, and 1 is infinitely fast. */
	calculatePureSpeedScore(answerTimeMs: number): number {
		if (!this.hasSpeedStats())
			throw new Error(
				"Cannot calculate speed score for a question with no speed statistics.",
			);
		const zScore =
			(answerTimeMs - this.speedStats.mean) / this.speedStats.standardDeviation;
		return 1 / (1 + Math.exp(zScore)); // Sigmoid function to map z-score to [0, 1]
	}

	/** Calculates a rating for a human's speed in answering this question between 0 and 1, weighted by the accuracy of their answer. */
	calculateWeightedSpeedScore(answerTimeMs: number, accuracy: number): number {
		const speedScore = this.calculatePureSpeedScore(answerTimeMs);
		return speedScore - (speedScore - 0.5) * ACCURACY_WEIGHT_FOR_SPEED_RATING * (1 - accuracy)
	}

	getDiscreteParts(
		_correctAnswer: Answer,
		_givenAnswer: Answer,
	): Record<QuestionPartId, boolean> {
		return {};
	}

	getContinuousParts(
		_correctAnswer: Answer,
		_givenAnswer: Answer,
	): Record<QuestionPartId, number> {
		return {};
	}

	calculateAccuracy(correctAnswer: Answer, givenAnswer: Answer): number {
		return this.calculateAccuracyFromParts(
			this.getDiscreteParts(correctAnswer, givenAnswer),
			this.getContinuousParts(correctAnswer, givenAnswer),
		);
	}
}

// --- Example question types ---

type Primitive = string | number | boolean | bigint | symbol | undefined | null;

class MultipleChoiceQuestion<
	Choice extends Primitive,
> extends Question<Choice> {
	constructor(numOptions: number) {
		super({ "": 1 / numOptions });
	}

	getDiscreteParts(
		correctAnswer: Choice,
		givenAnswer: Choice,
	): Record<QuestionPartId, boolean> {
		return { "": correctAnswer === givenAnswer };
	}
}

class TrueFalseQuestion extends MultipleChoiceQuestion<boolean> {
	constructor() {
		super(2);
	}
}

class DateQuestion extends Question<Temporal.PlainDate> {
	constructor(options: {
		numPossibleYears?: number;
		minStandardDeviationDays?: number;
	}) {
		super(
			{
				year: options.numPossibleYears
					? 1 / options.numPossibleYears
					: undefined,
				month: 1 / 12,
				day: 1 / 31,
			},
			{ "": options.minStandardDeviationDays },
		);
	}

	getDiscreteParts(
		correctAnswer: Temporal.PlainDate,
		givenAnswer: Temporal.PlainDate,
	): Record<QuestionPartId, boolean> {
		return {
			year: correctAnswer.year === givenAnswer.year,
			month: correctAnswer.month === givenAnswer.month,
			day: correctAnswer.day === givenAnswer.day,
		};
	}

	getContinuousParts(
		correctAnswer: Temporal.PlainDate,
		givenAnswer: Temporal.PlainDate,
	): Record<QuestionPartId, number> {
		return { "": correctAnswer.since(givenAnswer).total("days") };
	}
}

// --- Answer processing ---

/** Updates the Glicko ratings of two players based on the outcome of a game between them. */
function updateGlickoRating(
	playerRating: GlickoRating,
	opponentRating: GlickoRating,
	score: number,
	date: Date,
): void {
	playerRating.decay(date);
	opponentRating.decay(date);
	const playerOriginalRating = playerRating.copy();
	playerRating.update(opponentRating, score);
	opponentRating.update(playerOriginalRating, 1 - score);
}

/** Processes a human's answer to a question, updating the question's statistics and both players' Glicko ratings. */
function processAnswer<Answer>(
	human: Human,
	question: Question<Answer>,
	correctAnswer: Answer,
	givenAnswer: Answer,
	playedAt: Date,
	answerTimeMs: number,
): void {
	const correctDiscreteParts = question.getDiscreteParts(
		correctAnswer,
		givenAnswer,
	);
	const continuousPartErrors = question.getContinuousParts(
		correctAnswer,
		givenAnswer,
	);
	const accuracy = question.calculateAccuracyFromParts(
		correctDiscreteParts,
		continuousPartErrors,
	);
	updateGlickoRating(
		human.proficiencyRating,
		question.difficultyRating,
		accuracy,
		playedAt,
	);
	question.tuneDifficultyModel(correctDiscreteParts, continuousPartErrors);

	if (question.hasSpeedStats()) {
		const speed = question.calculateWeightedSpeedScore(answerTimeMs, accuracy);
		updateGlickoRating(
			human.fluencyRating,
			question.timeDemandRating,
			speed,
			playedAt,
		);
	}
	if (accuracy > ACCURACY_THRESHOLD_FOR_SPEED_TUNING) {
		question.tuneSpeedModel(answerTimeMs);
	}

	human.gamesPlayed++;
	question.gamesPlayed++;
}
