export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.METIS_EXPERIMENTAL === "1";
}

