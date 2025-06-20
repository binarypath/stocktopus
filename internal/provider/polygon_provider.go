package provider

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"stocktopus/internal/model"

	polygon "github.com/polygon-io/client-go/rest"
	"github.com/polygon-io/client-go/rest/models"
)

type PolygonProvider struct {
}

// PolygonProvider creates a new instance of our mock provider.
func NewPolygonProvider() *PolygonProvider {
	return &PolygonProvider{}
}

// https://polygon.io/docs/rest/crypto/aggregates/custom-bars
func (p *PolygonProvider) FetchStocks() ([]model.Stock, error) {
	c := polygon.New(os.Getenv("POLYGON_API_KEY"))

	from, err := time.Parse("2006-01-02", "2025-06-18")
	if err != nil {
		log.Fatalf("Error parsing 'from' date: %v", err)
	}

	to, err := time.Parse("2006-01-02", "2025-06-19")
	if err != nil {
		log.Fatalf("Error parsing 'to' date: %v", err)
	}

	params := models.ListAggsParams{
		Ticker:     "X:BTCUSD",
		Multiplier: 1,
		Timespan:   "day",
		From:       models.Millis(from),
		To:         models.Millis(to),
	}.
		WithAdjusted(true).
		WithOrder(models.Order("asc")).
		WithLimit(120)

	iter := c.ListAggs(context.Background(), params)

	for iter.Next() {
		log.Print(iter.Item().High)

	}

	if iter.Err() != nil {
		log.Fatal(iter.Err())
	}

	return

}

func (m *models.ListAggsResponse) ToStock() (model.Stock, error) {

	if m == nil {
		return model.Stock{}, errors.New("input Tickerm cannot be nil")
	}

	var dynamicSlice []model.Stock // This is a nil slice. len=0, cap=0.
	for i, result := range m.Results {
		stock := model.Stock{
			Ticker: m.Ticker,
			High:   m.Results[i].High,
			Low:    m.Results[i].Low,
			Open:   m.Results[i].Open,
			Close:  m.Results[i].Close,
			Price:  m.Results[i].Close,
			Volume: int64(m.Results[i].Volume),
		}

		dynamicSlice = append(dynamicSlice, stock)
	}

	return dynamicSlice, nil
}
