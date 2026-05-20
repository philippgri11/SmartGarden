from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

import httpx


class PostalCodeLookupError(RuntimeError):
    pass


@dataclass(slots=True)
class PostalCodeCoordinates:
    latitude: float
    longitude: float
    place_name: str | None = None


class PostalCodeGeocodingClient:
    def __init__(self, base_url: str, *, country_code: str = "de") -> None:
        self.base_url = base_url.rstrip("/")
        self.country_code = country_code.lower()

    def resolve(self, postal_code: str) -> PostalCodeCoordinates:
        normalized = "".join(character for character in postal_code.strip() if character.isdigit())
        if not normalized:
            raise PostalCodeLookupError("postal code is empty")

        url = f"{self.base_url}/{quote(self.country_code)}/{quote(normalized)}"
        try:
            with httpx.Client(timeout=8.0) as client:
                response = client.get(url)
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:  # noqa: BLE001
            raise PostalCodeLookupError(f"postal code lookup failed: {exc}") from exc

        places = payload.get("places") or []
        if not places:
            raise PostalCodeLookupError(f"postal code {normalized} was not found")

        first_place = places[0]
        try:
            latitude = float(first_place["latitude"])
            longitude = float(first_place["longitude"])
        except (KeyError, TypeError, ValueError) as exc:
            raise PostalCodeLookupError(f"postal code {normalized} returned invalid coordinates") from exc

        place_name = first_place.get("place name") or first_place.get("place_name")
        return PostalCodeCoordinates(latitude=latitude, longitude=longitude, place_name=place_name)
