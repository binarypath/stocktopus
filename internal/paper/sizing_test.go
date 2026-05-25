package paper

import (
	"errors"
	"math"
	"testing"
)

func TestComputeSize(t *testing.T) {
	tests := []struct {
		name       string
		input      TicketInput
		wantSize   float64
		wantRisk   float64
		wantErr    error
	}{
		{
			name: "equity long, 2% of 10k, $5 stop distance, 1.0 multiplier",
			input: TicketInput{
				InstrumentType: InstrumentEquity,
				Multiplier:     1,
				Side:           SideLong,
				EntryPrice:     150,
				StopPrice:      145,
				AccountSize:    10000,
				RiskPct:        0.02,
			},
			wantSize: 40, // floor(200 / 5) = 40 shares
			wantRisk: 200,
		},
		{
			name: "equity short, 2% of 10k, $5 stop distance above",
			input: TicketInput{
				InstrumentType: InstrumentEquity,
				Multiplier:     1,
				Side:           SideShort,
				EntryPrice:     145,
				StopPrice:      150,
				AccountSize:    10000,
				RiskPct:        0.02,
			},
			wantSize: 40,
			wantRisk: 200,
		},
		{
			name: "ES future, 2% of 10k, 4 points stop, multiplier 50",
			input: TicketInput{
				InstrumentType: InstrumentFuture,
				Multiplier:     50,
				Side:           SideLong,
				EntryPrice:     5000,
				StopPrice:      4996,
				AccountSize:    10000,
				RiskPct:        0.02,
			},
			wantSize: 1, // floor(200 / (4 * 50)) = floor(1.0) = 1
			wantRisk: 200,
		},
		{
			name: "Long option, premium-paid sizing, $2.50 premium, multiplier 100",
			input: TicketInput{
				InstrumentType: InstrumentOption,
				Multiplier:     100,
				Side:           SideLong,
				EntryPrice:     2.50,
				StopPrice:      0,
				AccountSize:    10000,
				RiskPct:        0.02,
			},
			wantSize: 0, // floor(200 / 250) = 0 — can't afford one contract at 2% on 10k
			wantRisk: 0,
		},
		{
			name: "Long option that fits, $1.50 premium",
			input: TicketInput{
				InstrumentType: InstrumentOption,
				Multiplier:     100,
				Side:           SideLong,
				EntryPrice:     1.50,
				StopPrice:      0,
				AccountSize:    10000,
				RiskPct:        0.02,
			},
			wantSize: 1, // floor(200 / 150) = 1
			wantRisk: 150,
		},
		{
			name: "1% risk after settling — half the size",
			input: TicketInput{
				InstrumentType: InstrumentEquity,
				Multiplier:     1,
				Side:           SideLong,
				EntryPrice:     150,
				StopPrice:      145,
				AccountSize:    10000,
				RiskPct:        0.01,
			},
			wantSize: 20, // floor(100 / 5)
			wantRisk: 100,
		},
		{
			name: "CFD, treated like equity for sizing",
			input: TicketInput{
				InstrumentType: InstrumentCFD,
				Multiplier:     1,
				Side:           SideLong,
				EntryPrice:     50,
				StopPrice:      48,
				AccountSize:    5000,
				RiskPct:        0.02,
			},
			wantSize: 50, // floor(100 / 2)
			wantRisk: 100,
		},
		{
			name: "Forex micro lot EURUSD, $0.10/pip multiplier, 50-pip stop",
			input: TicketInput{
				InstrumentType: InstrumentForex,
				Multiplier:     1000, // micro lot notional in base currency
				Side:           SideLong,
				EntryPrice:     1.0850,
				StopPrice:      1.0800,
				AccountSize:    10000,
				RiskPct:        0.02,
			},
			// stop distance 0.0050, perUnitRisk = 0.005 * 1000 = 5 per micro lot
			// size = floor(200 / 5) = 40 micro lots
			wantSize: 40,
			wantRisk: 200,
		},

		// Error paths
		{
			name: "negative account",
			input: TicketInput{
				InstrumentType: InstrumentEquity, Multiplier: 1, Side: SideLong,
				EntryPrice: 100, StopPrice: 95, AccountSize: -1, RiskPct: 0.02,
			},
			wantErr: ErrInvalidAccount,
		},
		{
			name: "risk over 100%",
			input: TicketInput{
				InstrumentType: InstrumentEquity, Multiplier: 1, Side: SideLong,
				EntryPrice: 100, StopPrice: 95, AccountSize: 10000, RiskPct: 1.5,
			},
			wantErr: ErrInvalidRisk,
		},
		{
			name: "long with stop above entry",
			input: TicketInput{
				InstrumentType: InstrumentEquity, Multiplier: 1, Side: SideLong,
				EntryPrice: 100, StopPrice: 105, AccountSize: 10000, RiskPct: 0.02,
			},
			wantErr: ErrSideStopMismatch,
		},
		{
			name: "stop equals entry",
			input: TicketInput{
				InstrumentType: InstrumentEquity, Multiplier: 1, Side: SideLong,
				EntryPrice: 100, StopPrice: 100, AccountSize: 10000, RiskPct: 0.02,
			},
			wantErr: ErrZeroStopDistance,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ComputeSize(tc.input)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("want error %v, got %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if math.Abs(got.Size-tc.wantSize) > 1e-9 {
				t.Errorf("size: want %v, got %v", tc.wantSize, got.Size)
			}
			if math.Abs(got.RiskAmount-tc.wantRisk) > 1e-9 {
				t.Errorf("risk: want %v, got %v", tc.wantRisk, got.RiskAmount)
			}
		})
	}
}
